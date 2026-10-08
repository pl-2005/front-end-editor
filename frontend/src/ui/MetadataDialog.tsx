import { Modal } from 'antd'
import { useId, useState } from 'react'
import { MetadataFields, type MetadataValues } from './MetadataFields'

/** Mount once per opened draft. Failed submissions retain input. */
export function MetadataDialog({
  kind = '项目',
  mode = 'edit',
  initialValues,
  busy,
  onSubmit,
  onCancel,
}: {
  kind?: '团队' | '项目'
  mode?: 'create' | 'edit'
  initialValues: MetadataValues
  busy: boolean
  onSubmit: (values: MetadataValues) => void
  onCancel: () => void
}) {
  const [values, setValues] = useState(initialValues)
  const formId = useId()
  return (
    <Modal
      open
      title={`${mode === 'edit' ? '编辑' : '创建'}${kind}`}
      okText={mode === 'edit' ? '保存' : kind === '团队' ? '创建团队' : '创建'}
      cancelText="取消"
      confirmLoading={busy}
      okButtonProps={{ htmlType: 'submit', form: formId, disabled: busy }}
      cancelButtonProps={{ disabled: busy }}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          if (busy || !values.name.trim()) return
          const normalized = {
            name: values.name.trim(),
            description: values.description?.trim() || null,
          }
          if (
            mode === 'edit' &&
            normalized.name === initialValues.name &&
            normalized.description === (initialValues.description ?? null)
          ) {
            onCancel()
            return
          }
          onSubmit(mode === 'create' ? values : normalized)
        }}
      >
        <MetadataFields kind={kind} values={values} busy={busy} onChange={setValues} />
      </form>
    </Modal>
  )
}
