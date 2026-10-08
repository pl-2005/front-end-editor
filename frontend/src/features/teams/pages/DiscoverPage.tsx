import { Button, Empty, Input, Table, Tag } from 'antd'
import * as teams from '../../../api/teams'
import { AppShell } from '../../../app/AppShell'
import { RouteBreadcrumb } from '../../../app/RouteBreadcrumb'
import { useTask } from '../../../hooks/useTask'
import type { Team } from '../../../types/team'
import { useDiscoverTeams } from '../hooks/useDiscoverTeams'

export function DiscoverPage() {
  const task = useTask()
  const setError = task.setError
  const {
    draftQuery,
    setDraftQuery,
    query,
    setQuery,
    page,
    setPage,
    pageSize,
    setPageSize,
    loadedQuery,
    total,
    items,
    pending,
    setPending,
    loading,
  } = useDiscoverTeams(setError)
  return (
    <AppShell>
      <section className="v2-section">
        <div className="v2-heading v2-discover-heading">
          <div>
            <RouteBreadcrumb>加入团队</RouteBreadcrumb>
            <h1>发现团队</h1>
          </div>
          <Input
            className="v2-discover-search"
            aria-label="搜索允许申请的团队"
            placeholder="搜索允许申请的团队"
            value={draftQuery}
            maxLength={100}
            allowClear
            onChange={(event) => setDraftQuery(event.target.value)}
            onClear={() => {
              setDraftQuery('')
              setQuery('')
              setPage(1)
            }}
          />
        </div>
        <Table<Team>
          className="v2-discover-table"
          size="small"
          rowKey="id"
          dataSource={loading ? [] : items}
          pagination={{
            current: page,
            pageSize,
            total: loadedQuery === query ? total : 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (count) => `共 ${count} 个团队`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPageSize === pageSize ? nextPage : 1)
              setPageSize(nextPageSize)
            },
          }}
          scroll={{ x: 680 }}
          loading={{ spinning: loading, description: '正在查找团队…' }}
          locale={{ emptyText: <Empty description="没有找到可申请的团队。" /> }}
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
              title: '申请状态',
              width: 120,
              align: 'center',
              render: (_: unknown, team: Team) =>
                pending.includes(team.id) ? (
                  <Tag color="processing">等待审批</Tag>
                ) : (
                  <Tag>可申请</Tag>
                ),
            },
            {
              title: '操作',
              width: 132,
              align: 'center',
              render: (_: unknown, team: Team) =>
                pending.includes(team.id) ? (
                  <Button
                    size="small"
                    htmlType="button"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        await teams.withdrawJoin(team.id)
                        setPending((ids) => ids.filter((id) => id !== team.id))
                      }, '申请已撤回。')
                    }
                  >
                    撤回申请
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    size="small"
                    htmlType="button"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        await teams.requestJoin(team.id)
                        setPending((ids) => [...ids, team.id])
                      }, '加入申请已提交，获批前无法查看团队项目。')
                    }
                  >
                    申请加入
                  </Button>
                ),
            },
          ]}
        />
      </section>
    </AppShell>
  )
}
