import { RestartIcon } from '@codesandbox/sandpack-react'

export function RestartPreviewButton({ onRestart }: { onRestart: () => void }) {
  return (
    <button
      className="sp-button preview-restart-button"
      onClick={onRestart}
      title="重启预览"
      aria-label="重启预览"
      type="button"
    >
      <RestartIcon />
    </button>
  )
}
