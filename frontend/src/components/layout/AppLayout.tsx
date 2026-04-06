import { Outlet } from 'react-router-dom'
import { Navbar } from './Navbar'

export function AppLayout() {
  return (
    <div className="min-h-screen flex bg-ds-surface text-ds-on-surface">
      <Navbar />
      {/* offset for fixed sidebar */}
      <main className="ml-56 flex-1 min-w-0 px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}
