import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import DiagnosticsWorker from './htmlDiagnostics.worker?worker'
import { language as jsTokens } from 'monaco-editor/esm/vs/basic-languages/javascript/javascript'
import { language as cssTokens } from 'monaco-editor/esm/vs/basic-languages/css/css'
import { language as htmlTokens } from 'monaco-editor/esm/vs/basic-languages/html/html'
import { language as mdTokens } from 'monaco-editor/esm/vs/basic-languages/markdown/markdown'
import { FILE_LANGUAGES } from '../../../../collaboration/src/document-rules'
import type { HtmlIssue } from './htmlDiagnostics'

export { monaco }
export const LANGUAGE_BUDGET = 200 * 1024
export const FILE_TYPES = Object.freeze(Object.fromEntries(Object.entries(FILE_LANGUAGES).map(([extension, languageId]) => [extension, {
  languageId, worker: languageId === 'javascript' ? 'typescript' : ['html', 'css', 'json'].includes(languageId) ? languageId : 'editor',
  diagnostics: ['html', 'css', 'javascript'].includes(languageId),
}])))
const workers = { editor: EditorWorker, html: HtmlWorker, css: CssWorker, typescript: TsWorker, javascript: TsWorker, json: JsonWorker }
const tokens: Record<string, monaco.languages.IMonarchLanguage> = { javascript: jsTokens, css: cssTokens, html: htmlTokens, json: { tokenizer: { root: [[/"(?:[^"\\]|\\.)*"/, 'string'], [/-?\d+(?:\.\d+)?/, 'number'], [/true|false|null/, 'keyword'], [/[{}[\],:]/, 'delimiter']] } }, markdown: mdTokens }
let registered = false
export function languageFor(language: string, code: string) {
  return new TextEncoder().encode(code).length <= LANGUAGE_BUDGET || language === 'plaintext' ? language : `budget-${language}`
}
export function modelUri(userId: number, projectId: number, epoch: number, path: string) {
  return monaco.Uri.from({ scheme: 'file', path: `/workspaces/${userId}/${projectId}/${epoch}${path}` })
}
/** All workers/models are scoped to the mounted workspace and terminated on disposal. */
export function languageSession() {
  if (!registered) {
    for (const [id, language] of Object.entries(tokens)) {
      monaco.languages.register({ id: `budget-${id}` })
      monaco.languages.setMonarchTokensProvider(`budget-${id}`, language)
    }
    registered = true
  }
  const owned = new Set<Worker>()
  window.MonacoEnvironment = { getWorker: (_id: string, label: string) => {
    const Constructor = workers[label as keyof typeof workers] ?? EditorWorker
    const worker = new Constructor()
    // Monaco caches its generic editor worker across editors. Model disposal
    // removes its mirror text; terminating that shared cache breaks later editors.
    if (label !== 'editorWorkerService') owned.add(worker)
    return worker
  } }
  const js = monaco.languages.typescript.javascriptDefaults
  js.setCompilerOptions({ allowJs: true, checkJs: true, allowNonTsExtensions: true, noEmit: true,
    target: monaco.languages.typescript.ScriptTarget.ESNext, module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs, lib: ['es2022', 'dom'], strict: true })
  js.setEagerModelSync(true)
  js.setModeConfiguration({ ...js.modeConfiguration, diagnostics: false })
  monaco.languages.css.cssDefaults.setModeConfiguration({ ...monaco.languages.css.cssDefaults.modeConfiguration, diagnostics: false })
  const htmlWorker = new DiagnosticsWorker(); owned.add(htmlWorker)
  const cssDiagnostics = monaco.editor.createWebWorker<{ doValidation(uri: string): Promise<{ severity?: number; message: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[]> }>({
    moduleId: 'vs/language/css/cssWorker', label: 'css', createData: { languageId: 'css', options: monaco.languages.css.cssDefaults.options } })
  let nextId = 0, disposed = false, generation = 0
  const htmlPending = new Map<number, (issues: HtmlIssue[]) => void>()
  htmlWorker.onmessage = (event: MessageEvent<{ id: number; issues: HtmlIssue[] }>) => {
    htmlPending.get(event.data.id)?.(event.data.issues); htmlPending.delete(event.data.id)
  }
  htmlWorker.onerror = () => { console.error('HTML diagnostics worker failed'); htmlPending.forEach(resolve => resolve([])); htmlPending.clear() }
  const htmlCheck = (code: string) => new Promise<HtmlIssue[]>(resolve => {
    const id = ++nextId; htmlPending.set(id, resolve); htmlWorker.postMessage({ id, code })
  })
  const textMessage = (value: string | monaco.languages.typescript.DiagnosticMessageChain): string => typeof value === 'string' ? value : value.messageText + (value.next?.map(textMessage).join('\n') ?? '')
  return {
    invalidate() { generation++ },
    async diagnose(model: monaco.editor.ITextModel) {
      const requestedGeneration = generation
      const version = model.getVersionId(), language = model.getLanguageId(), uri = model.uri.toString()
      const markers: monaco.editor.IMarkerData[] = []
      if (language === 'html') {
        for (const issue of await htmlCheck(model.getValue())) {
          const start = model.getPositionAt(issue.offset), end = model.getPositionAt(issue.offset + issue.length)
          markers.push({ severity: monaco.MarkerSeverity.Warning, message: issue.message, startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column })
        }
      } else if (language === 'css') {
        await cssDiagnostics.withSyncedResources([model.uri])
        const worker = await cssDiagnostics.getProxy()
        const diagnostics = await worker.doValidation(uri)
        for (const d of diagnostics) markers.push({ severity: d.severity === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: d.message,
          startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1, endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1 })
      } else if (language === 'javascript') {
        const worker = await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri)
        const diagnostics = [...await worker.getSyntacticDiagnostics(uri), ...await worker.getSemanticDiagnostics(uri)]
        for (const d of diagnostics.slice(0, 100)) {
          const start = model.getPositionAt(d.start ?? 0), end = model.getPositionAt((d.start ?? 0) + (d.length ?? 1))
          markers.push({ severity: d.category === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: textMessage(d.messageText), code: String(d.code),
            startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column })
        }
      }
      if (!disposed && requestedGeneration === generation && !model.isDisposed() && version === model.getVersionId() && language === model.getLanguageId()) monaco.editor.setModelMarkers(model, 'v2-language', markers)
    },
    dispose() {
      disposed = true
      cssDiagnostics.dispose()
      htmlPending.forEach(resolve => resolve([])); htmlPending.clear()
      // Reset native worker managers before the next workspace is mounted.
      js.setWorkerOptions({ ...js.workerOptions }); js.setExtraLibs([])
      monaco.languages.css.cssDefaults.setOptions({ ...monaco.languages.css.cssDefaults.options })
      monaco.languages.html.htmlDefaults.setOptions({ ...monaco.languages.html.htmlDefaults.options })
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ ...monaco.languages.json.jsonDefaults.diagnosticsOptions })
      owned.forEach(worker => worker.terminate()); owned.clear()
    },
  }
}
