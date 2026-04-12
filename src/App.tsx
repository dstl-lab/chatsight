// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Navigation } from './components/Navigation'
import { QueuePage } from './pages/QueuePage'
import { HistoryPage } from './pages/HistoryPage'
import { LabelsPage } from './pages/LabelsPage'
import { AnalysisPage } from './pages/AnalysisPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-canvas text-on-canvas flex flex-col">
        <Navigation />
        <main className="flex-1 flex flex-col min-h-0">
          <Routes>
            <Route path="/" element={<Navigate to="/queue" replace />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
