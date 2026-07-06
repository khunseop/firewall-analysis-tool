import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/components/pages/LoginPage'
import { DashboardPage } from '@/components/pages/DashboardPage'
import { DevicesPage } from '@/components/pages/DevicesPage'
import { PoliciesPage } from '@/components/pages/PoliciesPage'
import { ObjectsPage } from '@/components/pages/ObjectsPage'
import { AnalysisListPage } from '@/components/pages/AnalysisListPage'
import { AnalysisDetailPage } from '@/components/pages/AnalysisDetailPage'
import { SchedulesPage } from '@/components/pages/SchedulesPage'
import { SettingsPage } from '@/components/pages/SettingsPage'
import { NotificationsPage } from '@/components/pages/NotificationsPage'
import { PolicyDiffPage } from '@/components/pages/PolicyDiffPage'
import { DeletionWorkflowPage } from '@/components/pages/DeletionWorkflowPage'
import DeletionWorkflowListPage from '@/components/pages/DeletionWorkflowListPage'
import DeletionWorkflowDetailPage from '@/components/pages/DeletionWorkflowDetailPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  )
}
