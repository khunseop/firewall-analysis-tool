import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { LoginPage } from '@/components/pages/LoginPage'

// 페이지는 라우트 단위로 코드 스플리팅 (초기 번들 축소)
const DashboardPage = lazy(() => import('@/components/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const DevicesPage = lazy(() => import('@/components/pages/DevicesPage').then((m) => ({ default: m.DevicesPage })))
const PoliciesPage = lazy(() => import('@/components/pages/PoliciesPage').then((m) => ({ default: m.PoliciesPage })))
const ObjectsPage = lazy(() => import('@/components/pages/ObjectsPage').then((m) => ({ default: m.ObjectsPage })))
const AnalysisListPage = lazy(() => import('@/components/pages/AnalysisListPage').then((m) => ({ default: m.AnalysisListPage })))
const AnalysisDetailPage = lazy(() => import('@/components/pages/AnalysisDetailPage').then((m) => ({ default: m.AnalysisDetailPage })))
const SchedulesPage = lazy(() => import('@/components/pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })))
const SettingsPage = lazy(() => import('@/components/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const NotificationsPage = lazy(() => import('@/components/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const PolicyDiffPage = lazy(() => import('@/components/pages/PolicyDiffPage').then((m) => ({ default: m.PolicyDiffPage })))
const DeletionWorkflowPage = lazy(() => import('@/components/pages/DeletionWorkflowPage').then((m) => ({ default: m.DeletionWorkflowPage })))
const DeletionWorkflowListPage = lazy(() => import('@/components/pages/DeletionWorkflowListPage'))
const DeletionWorkflowDetailPage = lazy(() => import('@/components/pages/DeletionWorkflowDetailPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function PageFallback() {
  return (
    <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
      로딩 중...
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="devices" element={<DevicesPage />} />
                <Route path="policies" element={<PoliciesPage />} />
                <Route path="objects" element={<ObjectsPage />} />
                <Route path="analysis" element={<AnalysisListPage />} />
                <Route path="analysis/:taskId" element={<AnalysisDetailPage />} />
                <Route path="policy-diff" element={<PolicyDiffPage />} />
                <Route path="schedules" element={<SchedulesPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="deletion-workflow" element={<DeletionWorkflowListPage />} />
                <Route path="deletion-workflow/:id" element={<DeletionWorkflowDetailPage />} />
                <Route path="deletion-workflow/legacy" element={<DeletionWorkflowPage />} />
              </Route>
            </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  )
}
