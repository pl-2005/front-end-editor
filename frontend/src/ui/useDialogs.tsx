import { App, Input, Modal } from 'antd'
import { useRef, useState } from 'react'

interface PromptRequest {
  title: string
  initialValue: string
  maxLength: number
  resolve: (value: string | null) => void
}

/** 输入弹窗保留原生表单校验；取消不会执行调用方的业务操作。 */
export function useDialogs() {
  const { modal } = App.useApp()
  const [request, setRequest] = useState<PromptRequest | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const finish = (value: string | null) => {
    request?.resolve(value)
    setRequest(null)
  }
  const submit = () => {
    if (!form.current?.reportValidity()) return
    const value = String(new FormData(form.current).get('value') ?? '').trim()
    if (value) finish(value)
  }
  return {
    prompt: (title: string, initialValue = '', maxLength = 100) =>
      new Promise<string | null>((resolve) => {
        setRequest({ title, initialValue, maxLength, resolve })
      }),
    confirm: (title: string) =>
      modal.confirm({ title, okText: '确定', cancelText: '取消', okButtonProps: { danger: true } }),
    holder: (
      <Modal
        open={!!request}
        title={request?.title}
        destroyOnHidden
        okText="确定"
        cancelText="取消"
        onCancel={() => finish(null)}
        onOk={submit}
      >
        {request ? (
          <form
            ref={form}
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <label className="dialog-field">
              {request.title}
              <Input
                name="value"
                aria-label={request.title}
                autoFocus
                defaultValue={request.initialValue}
                required
                pattern=".*\S.*"
                maxLength={request.maxLength}
              />
            </label>
          </form>
        ) : null}
      </Modal>
    ),
  }
}
