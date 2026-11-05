import type { ReactNode } from 'react'
import { Header } from './Header.tsx'

interface AppLayoutProps {
  sidebar: ReactNode
  children: ReactNode
}

export function AppLayout({ sidebar, children }: AppLayoutProps) {
  return (
    <div className="app-layout">
      <Header />
      <div className="app-body">
        {sidebar}
        {children}
      </div>
    </div>
  )
}
