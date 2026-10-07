import { Grid, Splitter } from 'antd'
import { useState, type ReactNode } from 'react'

interface Props {
  showFiles: boolean
  showCode: boolean
  files: ReactNode
  code: ReactNode
  preview: ReactNode
}

/** 渲染页先下移，再将文件和代码上下排列；改变布局时保留面板内容及比例。 */
export function WorkspacePanels({ showFiles, showCode, files, code, preview }: Props) {
  const screens = Grid.useBreakpoint()
  const stackPreview = screens.lg === false
  const singleColumn = screens.sm === false
  const showEditor = showFiles || showCode
  const [filePercent, setFilePercent] = useState(36)
  const [editorPercent, setEditorPercent] = useState(50)
  const updatePercent = (sizes: number[], update: (value: number) => void) => {
    const total = sizes.reduce((sum, size) => sum + size, 0)
    if (total > 0) update((sizes[0] / total) * 100)
  }

  return (
    <div
      className="v2-workspace-grid"
      data-preview-stacked={stackPreview}
      data-single-column={singleColumn}
    >
      <Splitter
        className="v2-workspace-splitter"
        vertical={stackPreview}
        onResize={(sizes) => {
          if (showEditor) updatePercent(sizes, setEditorPercent)
        }}
      >
        <Splitter.Panel
          size={showEditor ? `${editorPercent}%` : 0}
          min={showEditor ? '20%' : 0}
          max={showEditor ? '80%' : 0}
          resizable={showEditor}
        >
          <Splitter
            className="v2-files-code-splitter"
            vertical={singleColumn}
            onResize={(sizes) => {
              if (showFiles && showCode) updatePercent(sizes, setFilePercent)
            }}
          >
            <Splitter.Panel
              size={showFiles ? (showCode ? `${filePercent}%` : '100%') : 0}
              min={showFiles ? (showCode ? '20%' : '100%') : 0}
              max={showFiles ? (showCode ? '70%' : '100%') : 0}
              resizable={showFiles && showCode}
            >
              {files}
            </Splitter.Panel>
            <Splitter.Panel min={showCode ? '30%' : 0} resizable={showCode}>
              {code}
            </Splitter.Panel>
          </Splitter>
        </Splitter.Panel>
        <Splitter.Panel className="v2-render-panel" min="20%">
          {preview}
        </Splitter.Panel>
      </Splitter>
    </div>
  )
}
