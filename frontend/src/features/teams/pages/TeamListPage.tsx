import { EditOutlined } from '@ant-design/icons'
import { Button, Empty, Table, Tooltip } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as teams from '../../../api/teams'
import { AppShell } from '../../../app/AppShell'
import { RouteBreadcrumb } from '../../../app/RouteBreadcrumb'
import { useTask } from '../../../hooks/useTask'
import type { Team } from '../../../types/team'
import { MetadataDialog } from '../../../ui/MetadataDialog'
import { useMyTeams } from '../hooks/useMyTeams'

export function TeamListPage() {
  const navigate = useNavigate()
  const task = useTask()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const { items, setItems, loaded } = useMyTeams()
  return (
    <AppShell>
      <section className="v2-section">
        <div className="v2-heading v2-team-heading">
          <div>
            <RouteBreadcrumb>
              <span aria-current="page">我的团队</span>
            </RouteBreadcrumb>
            <h1>我的团队</h1>
          </div>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            创建团队
          </Button>
        </div>

        <Table<Team>
          className="v2-team-table"
          rowKey="id"
          rowClassName="v2-team-row"
          onRow={(team) => ({
            tabIndex: 0,
            'aria-label': `查看团队 ${team.name}`,
            onClick: () => navigate(`/teams/${team.id}`),
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                navigate(`/teams/${team.id}`)
              }
            },
          })}
          dataSource={items}
          tableLayout="fixed"
          pagination={false}
          scroll={{ x: 600 }}
          loading={{ spinning: !loaded, description: '正在加载团队…' }}
          locale={{
            emptyText: (
              <Empty description="还没有加入团队。你可以创建一个团队，或在“发现团队”中申请加入。" />
            ),
          }}
          columns={[
            {
              title: '团队名称',
              dataIndex: 'name',
              width: 220,
              render: (name: string) => <strong>{name}</strong>,
            },
            {
              title: '团队描述',
              dataIndex: 'description',
              render: (description: string | null) => (
                <span className="v2-team-description">{description || '暂无描述'}</span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 100,
              align: 'center',
              render: (_, team) =>
                team.role === 'OWNER' ? (
                  <Tooltip title="编辑">
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      aria-label="编辑"
                      disabled={task.busy}
                      onClick={(event) => {
                        event.stopPropagation()
                        setEditingTeam(team)
                      }}
                    />
                  </Tooltip>
                ) : null,
            },
          ]}
        />
        {editingTeam ? (
          <MetadataDialog
            key={editingTeam.id}
            initialValues={editingTeam}
            kind="团队"
            busy={task.busy}
            onCancel={() => setEditingTeam(null)}
            onSubmit={({ name, description }) => {
              void task.run(async () => {
                const next = await teams.updateTeam(editingTeam.id, name, description)
                setItems((current) => current.map((item) => (item.id === next.id ? next : item)))
                setEditingTeam(null)
              }, '团队已更新。')
            }}
          />
        ) : null}
        {createOpen ? (
          <MetadataDialog
            kind="团队"
            mode="create"
            initialValues={{ name: '', description: '' }}
            busy={task.busy}
            onCancel={() => setCreateOpen(false)}
            onSubmit={(values) => {
              void task.run(async () => {
                const team = await teams.createTeam(values.name, values.description ?? '')
                navigate(`/teams/${team.id}`)
              })
            }}
          />
        ) : null}
      </section>
    </AppShell>
  )
}
