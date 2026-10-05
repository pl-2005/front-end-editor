import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { MonacoBinding } from 'y-monaco'
import { LIMITS, type FileRecord } from '../../collaboration/document'
import type { CollaborationSession } from '../../collaboration/session'
import { languageFor, languageSession, modelUri, monaco } from './languages'

interface Props { session: CollaborationSession; files: FileRecord[]; activeId: string; writable: boolean }
interface BoundModel { model: monaco.editor.ITextModel; binding: MonacoBinding; timer?: ReturnType<typeof setTimeout>; change: monaco.IDisposable; path: string; text: Y.Text; diagnose: () => void; view?: monaco.editor.ICodeEditorViewState | null }
/** Imperative models avoid React renders for every keystroke; only Y.Text is authoritative. */
export function MonacoWorkspace({ session, files, activeId, writable }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const runtime = useRef<{ editor: monaco.editor.IStandaloneCodeEditor; models: Map<string, BoundModel>; undo: Y.UndoManager; languages: ReturnType<typeof languageSession>; active?: string } | null>(null)
  const [warning, setWarning] = useState('')
  useEffect(() => {
    const languages = languageSession()
    const editor = monaco.editor.create(host.current!, { theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, readOnly: true,
      fontSize: 14, tabSize: 2, wordWrap: 'on', ariaLabel: '协作代码编辑器', fixedOverflowWidgets: true })
    const undo = new Y.UndoManager(session.doc.getMap('files'), { trackedOrigins: new Set([MonacoBinding]), captureTimeout: 400 })
    const applyUndo = (redo: boolean) => { if (session.state.writable) { if (redo) undo.redo(); else undo.undo() } }
    editor.addAction({ id: 'undo', label: '撤销本地编辑', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ], run: () => applyUndo(false), contextMenuGroupId: '1_modification', contextMenuOrder: 1 })
    editor.addAction({ id: 'redo', label: '重做本地编辑', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY], run: () => applyUndo(true), contextMenuGroupId: '1_modification', contextMenuOrder: 2 })
    // Saving is automatic; suppress the browser Save Page dialog.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {})
    runtime.current = { editor, models: new Map(), undo, languages }
    return () => {
      const current = runtime.current; runtime.current = null
      if (current) for (const item of current.models.values()) {
        clearTimeout(item.timer); item.change.dispose(); item.binding.destroy(); monaco.editor.setModelMarkers(item.model, 'v2-language', []); item.model.dispose()
      }
      undo.destroy(); editor.dispose(); languages.dispose()
    }
  }, [session])
  useEffect(() => {
    const current = runtime.current
    if (!current) return
    const { models, editor, languages } = current
    languages.invalidate()
    const ids = new Set(files.map(f => f.id))
    for (const [id, item] of models) if (!ids.has(id) || files.find(f => f.id === id)?.path !== item.path) {
      if (editor.getModel() === item.model) editor.setModel(null)
      clearTimeout(item.timer); item.change.dispose(); item.binding.destroy(); monaco.editor.setModelMarkers(item.model, 'v2-language', []); item.model.dispose(); models.delete(id)
    }
    for (const file of files) {
      let item = models.get(file.id)
      const code = file.content.toString(), language = languageFor(file.language, code)
      if (!item) {
        const model = monaco.editor.createModel(code, language, modelUri(session.userId, session.identity.projectId, session.identity.epoch, file.path))
        const diagnose = () => {
          const bound = models.get(file.id)
          if (!bound) return
          clearTimeout(bound.timer)
          bound.timer = setTimeout(() => { void languages.diagnose(model).catch(() => { if (!model.isDisposed()) { monaco.editor.setModelMarkers(model, 'v2-language', []); setWarning('语言诊断暂不可用') } }) }, 300)
        }
        const binding = new MonacoBinding(file.content, model, new Set([editor]))
        // y-monaco 0.1.6 exposes its mutex and change subscription. Replace only
        // the input subscription to validate before a local transaction is sent.
        binding._monacoChangeHandler.dispose()
        binding._monacoChangeHandler = model.onDidChangeContent(event => binding.mux(() => {
          const text = model.getValue(), size = new TextEncoder().encode(text).length
          const otherBytes = [...session.doc.getMap<Y.Map<unknown>>('files').values()].reduce((total, f) => total + (f.get('content') === file.content ? 0 : new TextEncoder().encode((f.get('content') as Y.Text).toString()).length), 0)
          if ((!session.state.writable && text !== file.content.toString()) || size > LIMITS.fileBytes || otherBytes + size > LIMITS.totalBytes) {
            model.setValue(file.content.toString())
            setWarning(session.state.writable ? '文件超出协作容量，修改未提交' : `当前不可编辑，修改未提交：${session.state.error || session.state.connection}`)
            return
          }
          setWarning('')
          session.doc.transact(() => {
            for (const change of [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
              file.content.delete(change.rangeOffset, change.rangeLength); file.content.insert(change.rangeOffset, change.text)
            }
          }, binding)
        }))
        const listener = model.onDidChangeContent(() => {
          const nextLanguage = languageFor(file.language, model.getValue())
          if (model.getLanguageId() !== nextLanguage) monaco.editor.setModelLanguage(model, nextLanguage)
          monaco.editor.setModelMarkers(model, 'v2-language', []); diagnose()
        })
        item = { model, binding, path: file.path, text: file.content, change: listener, diagnose }
        models.set(file.id, item); diagnose()
      } else if (item.model.getLanguageId() !== language) { monaco.editor.setModelLanguage(item.model, language); monaco.editor.setModelMarkers(item.model, 'v2-language', []) }
    }
    // Imports depend on other model versions and file names, not just this model.
    for (const item of models.values()) {
      monaco.editor.setModelMarkers(item.model, 'v2-language', []); item.diagnose()
    }
    if (current.active !== activeId || editor.getModel() !== models.get(activeId)?.model) {
      const previous = current.active && models.get(current.active)
      if (previous && current.active) models.set(current.active, { ...previous, view: editor.saveViewState() })
      const next = models.get(activeId)
      editor.setModel(next?.model ?? null)
      if (next?.view) editor.restoreViewState(next.view)
      current.active = activeId; current.undo.stopCapturing()
    }
    editor.updateOptions({ readOnly: !writable })
  }, [session, files, activeId, writable])
  const active = files.find(f => f.id === activeId)
  const budgetExceeded = active && languageFor(active.language, active.content.toString()).startsWith('budget-')
  return <div className="v2-monaco-pane">{warning ? <p role="alert">{warning}</p> : null}{budgetExceeded ? <p role="status">大文件保留编辑与高亮，补全和诊断暂不可用。</p> : null}<div ref={host} className="v2-monaco" /></div>
}
