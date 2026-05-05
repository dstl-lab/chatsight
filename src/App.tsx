// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Navigation } from './components/Navigation'
import { QueuePage } from './pages/QueuePage'
import { HistoryPage } from './pages/HistoryPage'
import { LabelsPage } from './pages/LabelsPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { LabelRunPage } from './pages/LabelRunPage'
import { AssignmentsPage } from './pages/AssignmentsPage'
import { SummariesPage } from './pages/SummariesPage'
import { ModeProvider, useMode } from './hooks/useMode'

function ModeAwareRedirect() {
  const { mode } = useMode()
  return <Navigate to={mode === 'single' ? '/run' : '/queue'} replace />
}

function AppShell() {
  const { mode } = useMode()
  // Single-label mode wraps the entire app shell (including nav) in the warm
  // editorial palette so there's no cool-gray seam at the top.
  const shellClasses = `h-screen bg-canvas text-on-canvas flex flex-col overflow-hidden ${
    mode === 'single' ? 'warm-flow' : ''
  }`
  return (
    <div className={shellClasses}>
      <Navigation />
      <main className="flex-1 flex flex-col min-h-0">
        <Routes>
          <Route path="/" element={<ModeAwareRedirect />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/run" element={<LabelRunPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/labels" element={<LabelsPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/summaries" element={<SummariesPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ModeProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ModeProvider>
  )
}
