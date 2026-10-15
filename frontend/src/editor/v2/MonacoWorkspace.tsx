import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { MonacoBinding } from 'y-monaco'
import { LIMITS, type FileRecord } from '../../collaboration/document'
import type { CollaborationSession } from '../../collaboration/session'
import { languageFor, languageSession, modelUri, monaco } from './languages'
import { presenceColors } from '../../collaboration/presenceColors'
import { useFeedback } from '../../ui/useNotice'
import type { SourceLocation } from '../visual/canvas/DesignCanvas'

interface Props {
  session: CollaborationSession
  files: FileRecord[]
  activeId: string
  writable: boolean
  sourceLocation?: SourceLocation
}
interface BoundModel {
  model: monaco.editor.ITextModel
  binding: MonacoBinding
  timer?: ReturnType<typeof setTimeout>
  change: monaco.IDisposable
  path: string
  text: Y.Text
  diagnose: () => void
  view?: monaco.editor.ICodeEditorViewState | null
}
/** Imperative models avoid React renders for every keystroke; only Y.Text is authoritative. */
export function MonacoWorkspace({ session, files, activeId, writable, sourceLocation }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const runtime = useRef<{
    editor: monaco.editor.IStandaloneCodeEditor
    models: Map<string, BoundModel>
    undo: Y.UndoManager
    languages: ReturnType<typeof languageSession>
    active?: string
    renderPresence?: () => void
  } | null>(null)
  const [warning, setWarning] = useState('')
  const lastLocation = useRef('')
  useEffect(() => {
    const languages = languageSession()
    const editor = monaco.editor.create(host.current!, {
      theme: 'vs',
      automaticLayout: true,
      minimap: { enabled: false },
      readOnly: true,
      fontSize: 14,
      tabSize: 2,
      wordWrap: 'on',
      cursorBlinking: 'blink',
      ariaLabel: '协作代码编辑器',
      fixedOverflowWidgets: true,
    })
    const undo = new Y.UndoManager(session.doc.getMap('files'), {
      trackedOrigins: new Set([MonacoBinding]),
      captureTimeout: 400,
    })
    const applyUndo = (redo: boolean) => {
      try {
        session.undo(undo, redo)
      } catch (cause) {
        setWarning(cause instanceof Error ? cause.message : '撤销失败')
      }
    }
    editor.addAction({
      id: 'undo',
      label: '撤销本地编辑',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      run: () => applyUndo(false),
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1,
    })
    editor.addAction({
      id: 'redo',
      label: '重做本地编辑',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
      ],
      run: () => applyUndo(true),
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 2,
    })
    // Saving is automatic; suppress the browser Save Page dialog.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {})
    runtime.current = { editor, models: new Map(), undo, languages }
    const decorations = editor.createDecorationsCollection(),
      style = document.createElement('style')
    document.head.append(style)
    const cursorLabels = new Map<
      number,
      { widget: monaco.editor.IContentWidget; node: HTMLDivElement; position: monaco.IPosition }
    >()
    const clearLabels = (visible: Set<number>) => {
      for (const [id, label] of cursorLabels)
        if (!visible.has(id)) {
          editor.removeContentWidget(label.widget)
          cursorLabels.delete(id)
        }
    }
    const renderPresence = () => {
      const model = editor.getModel(),
        current = runtime.current
      if (!model || !current) {
        decorations.clear()
        clearLabels(new Set())
        return
      }
      const bound = current.active ? current.models.get(current.active) : undefined
      const next: monaco.editor.IModelDeltaDecoration[] = [],
        css: string[] = []
      const visible = new Set<number>(),
        colors = presenceColors([
          session.userId,
          ...[...session.awareness.getStates().values()]
            .map((state) => state.user?.id)
            .filter(Number.isSafeInteger),
        ])
      for (const [clientId, state] of session.awareness.getStates()) {
        if (
          clientId === session.doc.clientID ||
          state.activeFileId !== current.active ||
          !state.selection ||
          !bound
        )
          continue
        try {
          const anchor = Y.createAbsolutePositionFromRelativePosition(
            state.selection.anchor,
            session.doc,
          )
          const head = Y.createAbsolutePositionFromRelativePosition(
            state.selection.head,
            session.doc,
          )
          if (!anchor || !head || anchor.type !== bound.text || head.type !== bound.text) continue
          const a = model.getPositionAt(Math.min(anchor.index, head.index)),
            b = model.getPositionAt(Math.max(anchor.index, head.index))
          const color = colors.get(state.user?.id)
          if (!color) continue
          const position = model.getPositionAt(head.index),
            name = String(state.user?.name ?? '协作者')
          visible.add(clientId)
          let label = cursorLabels.get(clientId)
          if (!label) {
            const node = document.createElement('div')
            node.className = 'v2-cursor-name'
            const item = {
              node,
              position,
              widget: {
                getId: () => `v2-cursor-name-${clientId}`,
                getDomNode: () => node,
                allowEditorOverflow: true,
                getPosition: () => ({
                  position: item.position,
                  preference: [
                    monaco.editor.ContentWidgetPositionPreference.ABOVE,
                    monaco.editor.ContentWidgetPositionPreference.BELOW,
                  ],
                }),
              },
            }
            label = item
            cursorLabels.set(clientId, item)
            editor.addContentWidget(item.widget)
          }
          label.position = position
          label.node.textContent = name
          label.node.style.color = color
          label.node.style.borderColor = color
          label.node.setAttribute('aria-label', `${name} 的光标`)
          editor.layoutContentWidget(label.widget)
          css.push(
            `.v2-remote-${clientId}{background:${color.replace(')', ' / 0.18)')}}.v2-head-${clientId}{border-left:2px solid ${color};height:100%}`,
          )
          next.push({
            range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column),
            options: {
              className: `v2-remote-${clientId}`,
              hoverMessage: { value: name.replace(/[\\`*_{}[\]()#+.!<>]/g, '\\$&') },
            },
          })
          next.push({
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
            options: {
              beforeContentClassName: `v2-remote-cursor v2-head-${clientId}`,
              showIfCollapsed: true,
            },
          })
        } catch {
          /* A relative position can disappear when its file is deleted. */
        }
      }
      clearLabels(visible)
      decorations.set(next)
      style.textContent = css.join('\n')
    }
    runtime.current.renderPresence = renderPresence
    let selectionTimer: ReturnType<typeof setTimeout> | undefined
    const selection = editor.onDidChangeCursorSelection(() => {
      clearTimeout(selectionTimer)
      selectionTimer = setTimeout(() => {
        const current = runtime.current,
          model = editor.getModel(),
          sel = editor.getSelection()
        const bound = current?.active ? current.models.get(current.active) : undefined
        if (model && sel && bound)
          session.setSelection({
            anchor: Y.createRelativePositionFromTypeIndex(
              bound.text,
              model.getOffsetAt({
                lineNumber: sel.selectionStartLineNumber,
                column: sel.selectionStartColumn,
              }),
            ),
            head: Y.createRelativePositionFromTypeIndex(
              bound.text,
              model.getOffsetAt({ lineNumber: sel.positionLineNumber, column: sel.positionColumn }),
            ),
          })
      }, 80)
    })
    session.awareness.on('change', renderPresence)
    const presenceModel = editor.onDidChangeModel(renderPresence),
      presenceContent = editor.onDidChangeModelContent(renderPresence)
    return () => {
      clearTimeout(selectionTimer)
      selection.dispose()
      presenceModel.dispose()
      presenceContent.dispose()
      session.awareness.off('change', renderPresence)
      decorations.clear()
      clearLabels(new Set())
      style.remove()
      const current = runtime.current
      runtime.current = null
      if (current)
        for (const item of current.models.values()) {
          clearTimeout(item.timer)
          item.change.dispose()
          item.binding.destroy()
          session.forgetOrigin(item.binding)
          monaco.editor.setModelMarkers(item.model, 'v2-language', [])
          item.model.dispose()
        }
      undo.destroy()
      session.forgetOrigin(undo)
      editor.dispose()
      languages.dispose()
    }
  }, [session])
  useEffect(() => {
    const current = runtime.current
    if (!current) return
    const { models, editor, languages } = current
    languages.invalidate()
    const ids = new Set(files.map((f) => f.id))
    for (const [id, item] of models)
      if (!ids.has(id) || files.find((f) => f.id === id)?.path !== item.path) {
        if (editor.getModel() === item.model) editor.setModel(null)
        clearTimeout(item.timer)
        item.change.dispose()
        item.binding.destroy()
        session.forgetOrigin(item.binding)
        monaco.editor.setModelMarkers(item.model, 'v2-language', [])
        item.model.dispose()
        models.delete(id)
      }
    for (const file of files) {
      let item = models.get(file.id)
      const code = file.content.toString(),
        language = languageFor(file.language, code)
      if (!item) {
        const model = monaco.editor.createModel(
          code,
          language,
          modelUri(session.userId, session.identity.projectId, session.identity.epoch, file.path),
        )
        const diagnose = () => {
          const bound = models.get(file.id)
          if (!bound) return
          clearTimeout(bound.timer)
          bound.timer = setTimeout(() => {
            void languages.diagnose(model).catch(() => {
              if (!model.isDisposed()) {
                monaco.editor.setModelMarkers(model, 'v2-language', [])
                setWarning('语言诊断暂不可用')
              }
            })
          }, 300)
        }
        const binding = new MonacoBinding(file.content, model, new Set([editor]))
        // y-monaco 0.1.6 exposes its mutex and change subscription. Replace only
        // the input subscription to validate before a local transaction is sent.
        binding._monacoChangeHandler.dispose()
        binding._monacoChangeHandler = model.onDidChangeContent((event) =>
          binding.mux(() => {
            const text = model.getValue(),
              size = new TextEncoder().encode(text).length
            const otherBytes = [...session.doc.getMap<Y.Map<unknown>>('files').values()].reduce(
              (total, f) =>
                total +
                (f.get('content') === file.content
                  ? 0
                  : new TextEncoder().encode((f.get('content') as Y.Text).toString()).length),
              0,
            )
            if (
              (!session.state.writable && text !== file.content.toString()) ||
              size > LIMITS.fileBytes ||
              otherBytes + size > LIMITS.totalBytes
            ) {
              model.setValue(file.content.toString())
              setWarning(
                session.state.writable
                  ? '文件超出协作容量，修改未提交'
                  : `当前不可编辑，修改未提交：${session.state.error || session.state.connection}`,
              )
              return
            }
            setWarning('')
            try {
              session.mutate((doc) => {
                const text = doc
                  .getMap<Y.Map<unknown>>('files')
                  .get(file.id)!
                  .get('content') as Y.Text
                for (const change of [...event.changes].sort(
                  (a, b) => b.rangeOffset - a.rangeOffset,
                )) {
                  text.delete(change.rangeOffset, change.rangeLength)
                  text.insert(change.rangeOffset, change.text)
                }
              }, binding)
              session.markEdited(file.id)
            } catch (cause) {
              model.setValue(file.content.toString())
              setWarning(cause instanceof Error ? cause.message : '修改未提交')
            }
          }),
        )
        const listener = model.onDidChangeContent(() => {
          const nextLanguage = languageFor(file.language, model.getValue())
          if (model.getLanguageId() !== nextLanguage)
            monaco.editor.setModelLanguage(model, nextLanguage)
          monaco.editor.setModelMarkers(model, 'v2-language', [])
          diagnose()
        })
        item = { model, binding, path: file.path, text: file.content, change: listener, diagnose }
        models.set(file.id, item)
        diagnose()
      } else if (item.model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(item.model, language)
        monaco.editor.setModelMarkers(item.model, 'v2-language', [])
      }
    }
    // Imports depend on other model versions and file names, not just this model.
    for (const item of models.values()) {
      monaco.editor.setModelMarkers(item.model, 'v2-language', [])
      item.diagnose()
    }
    if (current.active !== activeId || editor.getModel() !== models.get(activeId)?.model) {
      const previous = current.active && models.get(current.active)
      if (previous && current.active)
        models.set(current.active, { ...previous, view: editor.saveViewState() })
      const next = models.get(activeId)
      editor.setModel(next?.model ?? null)
      if (next?.view) editor.restoreViewState(next.view)
      current.active = activeId
      current.undo.stopCapturing()
    }
    editor.updateOptions({ readOnly: !writable })
    current.renderPresence?.()
  }, [session, files, activeId, writable])
  useEffect(() => {
    const current = runtime.current
    if (
      !current ||
      !sourceLocation ||
      sourceLocation.fileId !== activeId ||
      lastLocation.current === sourceLocation.requestId
    )
      return
    lastLocation.current = sourceLocation.requestId
    const bound = current.models.get(activeId)
    const { source, range } = sourceLocation
    if (
      !bound ||
      bound.text.toString() !== source ||
      bound.model.getValue() !== source ||
      range.start < 0 ||
      range.end > source.length ||
      range.start > range.end
    )
      return
    const start = bound.model.getPositionAt(range.start)
    const end = bound.model.getPositionAt(range.end)
    const selection = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
    current.editor.setSelection(selection)
    current.editor.revealRangeInCenter(selection)
    current.editor.focus()
  }, [sourceLocation, activeId, files])
  const active = files.find((f) => f.id === activeId)
  const budgetExceeded =
    active && languageFor(active.language, active.content.toString()).startsWith('budget-')
  useFeedback({ error: warning })
  useFeedback({ notice: budgetExceeded ? '大文件保留编辑与高亮，补全和诊断暂不可用。' : '' })
  return (
    <div className="v2-monaco-pane">
      <div ref={host} className="v2-monaco" />
    </div>
  )
}
