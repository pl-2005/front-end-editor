import { Input } from 'antd'
export interface MetadataValues {
  name: string
  description: string | null
}
export function MetadataFields({
  kind,
  values,
  busy,
  onChange,
}: {
  kind: '项目' | '团队'
  values: MetadataValues
  busy: boolean
  onChange: (values: MetadataValues) => void
}) {
  return (
    <>
      <label className="dialog-field">
        {kind}名称
        <Input
          aria-label={`${kind}名称`}
          name="name"
          value={values.name}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
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
          name="description"
          value={values.description ?? ''}
          onChange={(event) => onChange({ ...values, description: event.target.value })}
          maxLength={500}
          rows={4}
          showCount
          disabled={busy}
        />
      </label>
    </>
  )
}
