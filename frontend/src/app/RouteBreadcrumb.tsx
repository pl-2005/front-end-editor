import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useNavigate } from 'react-router-dom'

export function RouteBreadcrumb({
  children,
  parentPath,
}: {
  children: React.ReactNode
  parentPath?: string
}) {
  const navigate = useNavigate()
  return (
    <nav className="v2-route-navigation" aria-label="面包屑">
      <Button
        type="text"
        size="small"
        htmlType="button"
        icon={<ArrowLeftOutlined />}
        aria-label="返回上一级"
        title="返回上一级"
        disabled={!parentPath}
        onClick={() => {
          if (parentPath) navigate(parentPath)
        }}
      />
      <p>{children}</p>
    </nav>
  )
}
