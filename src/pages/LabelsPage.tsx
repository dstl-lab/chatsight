import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import type { LabelDashboardItem } from '../types'

const phaseStyles: Record<string, string> = {
  labeling: 'bg-amber-700 text-amber-100',
  handed_off: 'bg-indigo-700 text-indigo-100',
  reviewing: 'bg-violet-700 text-violet-100',
  complete: 'bg-emerald-800 text-emerald-100',
}

export function LabelsPage() {
  const navigate = useNavigate()
  const [labels, setLabels] = useState<LabelDashboardItem[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setLabels(await api.listBinaryLabels())
  }

  useEffect(() => { refresh() }, [])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.createBinaryLabel({ name: name.trim(), description: description.trim() || undefined })
      setName('')
      setDescription('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const activate = async (id: number) => {
    await api.activateBinaryLabel(id)
    navigate('/run')
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 w-full">
      <h1 className="text-2xl font-semibold mb-6">Labels</h1>

      <form onSubmit={onCreate} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 mb-8 space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">New label</h2>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Label name"
          className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2"
        />
        <input
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (used as Gemini prompt context)"
          className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2"
        />
        <button
          type="submit" disabled={busy}
          className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-medium"
        >Create</button>
      </form>

      <div className="space-y-3">
        {labels.map((l) => (
          <div key={l.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{l.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${phaseStyles[l.phase] ?? 'bg-neutral-700 text-neutral-200'}`}>
                  {l.phase}
                </span>
                {l.is_active && <span className="text-xs px-2 py-0.5 rounded bg-emerald-700 text-emerald-100">active</span>}
              </div>
              {l.description && <p className="text-sm text-neutral-400 mt-1">{l.description}</p>}
              <p className="text-xs text-neutral-500 mt-1">
                {l.yes_count} yes · {l.no_count} no · {l.skip_count} skip · {l.ai_count} AI
              </p>
            </div>
            <div className="flex gap-2">
              {l.phase === 'complete' ? (
                <span className="text-neutral-500 text-sm">Closed</span>
              ) : l.is_active ? (
                <button onClick={() => navigate('/run')} className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500">
                  Resume
                </button>
              ) : (
                <button onClick={() => activate(l.id)} className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600">
                  Activate
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
