import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'

/** 为所有路由和编辑器控件提供统一的中文主题。 */
export function AppTheme({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#2563eb',
          colorText: '#1e293b',
          colorTextSecondary: '#64748b',
          colorBgLayout: '#f5f7fb',
          borderRadius: 8,
          controlHeight: 38,
          fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
        },
        components: {
          Card: { borderRadiusLG: 12 },
          Menu: {
            itemHeight: 32,
            horizontalLineHeight: '32px',
            horizontalItemBorderRadius: 8,
            horizontalItemSelectedColor: '#2563eb',
            horizontalItemSelectedBg: '#eff6ff',
            horizontalItemHoverColor: '#2563eb',
            horizontalItemHoverBg: '#f1f5f9',
            activeBarHeight: 0,
            activeBarBorderWidth: 0,
          },
        },
      }}
    >
      <AntApp
        notification={{
          placement: 'top',
          top: 20,
          duration: 3,
          maxCount: 5,
          stack: false,
          pauseOnHover: false,
        }}
      >
        {children}
      </AntApp>
    </ConfigProvider>
  )
}
