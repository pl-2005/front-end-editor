import { Input, Modal } from 'antd'
import { useState } from 'react'
import type { TeamProjectSummary } from '../types/collaboration'

export function ProjectEditDialog({
  project,
  busy,
  onCancel,
  onSave,
}: {
  project: TeamProjectSummary
  busy: boolean
  onCancel: () => void
  onSave: (name: string, description: string | null) => void
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  return (
    <Modal
      open
      title="编辑项目"
      okText="保存"
      cancelText="取消"
      confirmLoading={busy}
      okButtonProps={{ htmlType: 'submit', form: 'project-edit-form' }}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <form
        id="project-edit-form"
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
          项目名称
          <Input
            aria-label="项目名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            pattern=".*\S.*"
            maxLength={100}
            disabled={busy}
          />
        </label>
        <label className="dialog-field">
          项目描述（可选）
          <Input.TextArea
            aria-label="项目描述"
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
