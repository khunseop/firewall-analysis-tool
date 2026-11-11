import { Outlet } from 'react-router-dom'
import { Navbar } from './Navbar'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

export function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-ds-surface text-ds-on-surface">
      <div className="fixed top-0 inset-x-0 z-50 h-13">
        <Navbar />
      </div>
      <main className="mt-13">
        <div className="px-4 py-4 md:px-8 md:py-8">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}
// refresh
 
