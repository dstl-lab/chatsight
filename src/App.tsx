// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Navigation } from './components/Navigation'
import { LabelRunPage } from './pages/LabelRunPage'
import { HistoryPage } from './pages/HistoryPage'
import { LabelsPage } from './pages/LabelsPage'
import { AnalysisPage } from './pages/AnalysisPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
        <Navigation />
        <main className="flex-1 flex flex-col min-h-0">
          <Routes>
            <Route path="/" element={<Navigate to="/labels" replace />} />
            <Route path="/run" element={<LabelRunPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
