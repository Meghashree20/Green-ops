import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { CostCarbonPage } from './pages/CostCarbonPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OverviewPage } from './pages/OverviewPage'
import { RecommendationsPage } from './pages/RecommendationsPage'
import { ResourceExplorerPage } from './pages/ResourceExplorerPage'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="resources" element={<ResourceExplorerPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="cost-carbon" element={<CostCarbonPage />} />
        <Route path="recommendations" element={<RecommendationsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
