import { Outlet } from 'react-router-dom'
import { Navbar } from './Navbar'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-ds-surface text-ds-on-surface">
      <Navbar />
      <main className="max-w-screen-2xl mx-auto px-8 py-10 space-y-0">
        <Outlet />
      </main>
    </div>
  )
}
