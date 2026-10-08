import { BrowserRouter } from 'react-router-dom'
import { AppTheme } from './ui/AppTheme'
import { AppRoutes } from './app/AppRoutes'

export function V2App() {
  return (
    <AppTheme>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppTheme>
  )
}
