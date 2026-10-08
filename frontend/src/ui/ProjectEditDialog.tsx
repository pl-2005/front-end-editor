import { Input, Modal } from 'antd'
import { useState } from 'react'
import type { TeamProjectSummary } from '../types/collaboration'

export function ProjectEditDialog({
  project,
  busy,
  onCancel,
  onSave,
  kind = '项目',
}: {
  project: Pick<TeamProjectSummary, 'name' | 'description'>
  busy: boolean
  onCancel: () => void
  onSave: (name: string, description: string | null) => void
  kind?: '项目' | '团队'
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const formId = kind === '项目' ? 'project-edit-form' : 'team-edit-form'
  return (
    <Modal
      open
      title={`编辑${kind}`}
      okText="保存"
      cancelText="取消"
      confirmLoading={busy}
      okButtonProps={{ htmlType: 'submit', form: formId }}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          const nextName = name.trim()
          if (!nextName || busy) return
          const nextDescription = description.trim() || null
          if (nextName === project.name && nextDescription === (project.description ?? null)) {
            onCancel()
            return
          }
          onSave(nextName, nextDescription)
        }}
      >
        <label className="dialog-field">
          {kind}名称
          <Input
            aria-label={`${kind}名称`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            pattern=".*\S.*"
            maxLength={100}
            disabled={busy}
          />
        </label>
        <label className="dialog-field">
          {kind}描述（可选）
          <Input.TextArea
            aria-label={`${kind}描述`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={4}
            showCount
            disabled={busy}
          />
        </label>
      </form>
    </Modal>
  )
}
