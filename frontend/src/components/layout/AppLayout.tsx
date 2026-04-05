import { Outlet } from 'react-router-dom'
import { Navbar } from './Navbar'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-ds-surface">
      <Navbar />
      <main className="max-w-screen-2xl mx-auto px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}
