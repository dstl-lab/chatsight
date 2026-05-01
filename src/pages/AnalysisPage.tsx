import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisSummary, TemporalAnalysis } from '../types'
import { api } from '../services/api'

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type HeatmapMode = 'raw' | 'row' | 'column'
type AssignmentKind = 'due' | 'late' | 'release'
type LabelFreqMode = 'combined' | 'human' | 'ai'

interface AssignmentMilestone {
  title: string
  date: string // YYYY-MM-DD
  kind: AssignmentKind
  note?: string
}

/** DSC10 WI26 — due / late / quiz dates from Gradescope (PDT). */
const ASSIGNMENT_MILESTONES: AssignmentMilestone[] = [
  { title: 'Lab 0', date: '2026-01-12', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Pretest', date: '2026-01-12', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Grade Report', date: '2026-01-13', kind: 'due', note: 'Due 3:09 PM' },
  { title: 'Lab 0', date: '2026-01-14', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Pretest', date: '2026-01-14', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Lab 1', date: '2026-01-20', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'HW 1', date: '2026-01-21', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Quiz 1 (A/B)', date: '2026-01-23', kind: 'release', note: 'In-class' },
  { title: 'HW 1', date: '2026-01-23', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Lab 2', date: '2026-01-26', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'HW 2', date: '2026-01-28', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Lab 2', date: '2026-01-28', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'HW 2', date: '2026-01-30', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Lab 3', date: '2026-02-02', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'HW 3', date: '2026-02-04', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Lab 3', date: '2026-02-04', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'HW 3', date: '2026-02-06', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Quiz 2 (A/B/C)', date: '2026-02-06', kind: 'release', note: 'In-class' },
  { title: 'Research Assessment 1 (pre-test)', date: '2026-02-10', kind: 'due', note: 'Due (Gradescope)' },
  { title: 'Midterm Exam (A/B)', date: '2026-02-11', kind: 'release', note: 'In-class' },
  { title: 'Midterm Project', date: '2026-02-13', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Lab 4', date: '2026-02-17', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Midterm Project', date: '2026-02-17', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'HW 4', date: '2026-02-18', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Lab 4', date: '2026-02-19', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'HW 4', date: '2026-02-20', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Lab 5', date: '2026-02-23', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'HW 5', date: '2026-02-25', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Lab 5', date: '2026-02-25', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Quiz 3 (A/B/C)', date: '2026-02-27', kind: 'release', note: 'In-class' },
  { title: 'HW 5', date: '2026-02-27', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Lab 6', date: '2026-03-02', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Lab 6', date: '2026-03-04', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'HW 6', date: '2026-03-05', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Quiz 4 (A/B/C)', date: '2026-03-06', kind: 'release', note: 'In-class' },
  { title: 'HW 6', date: '2026-03-07', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Lab 7', date: '2026-03-09', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'SETs', date: '2026-03-10', kind: 'release', note: 'Opens 12:00 PM' },
  { title: 'Lab 7', date: '2026-03-11', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Final Project', date: '2026-03-12', kind: 'due', note: 'Due 11:59 PM' },
  { title: 'Research Assessment 2 (post-test)', date: '2026-03-13', kind: 'due', note: 'Due (Gradescope)' },
  { title: 'Final Project', date: '2026-03-14', kind: 'late', note: 'Late 11:59 PM' },
  { title: 'Final Exam', date: '2026-03-14', kind: 'due', note: 'Gradescope' },
  { title: 'SETs', date: '2026-03-14', kind: 'due', note: 'Due 8:00 AM' },
]

function monthRangeISO(d: Date): { from: string; to: string } {
  const y = d.getFullYear()
  const m = d.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` }
}

function addCalendarMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}

export function AnalysisPage() {
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [temporal, setTemporal] = useState<TemporalAnalysis | null>(null)
  const [temporalError, setTemporalError] = useState<string | null>(null)
  const [temporalLoading, setTemporalLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('row')
  const [labelFreqMode, setLabelFreqMode] = useState<LabelFreqMode>('combined')
  const [calMonth, setCalMonth] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getAnalysisSummary()
      .then((s) => {
        if (!cancelled) setSummary(s)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setTemporalLoading(true)
    setTemporalError(null)
    const { from, to } = monthRangeISO(calMonth)
    api
      .getTemporalAnalysis({ calendarFrom: from, calendarTo: to })
      .then((t) => {
        if (!cancelled) {
          setTemporal(t)
          setTemporalError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setTemporal(null)
          setTemporalError(e instanceof Error ? e.message : String(e))
        }
      })
      .finally(() => {
        if (!cancelled) setTemporalLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [calMonth])

  const byDayMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const row of temporal?.tutor_usage.by_day ?? []) {
      m.set(row.date, Number(row.count ?? 0))
    }
    return m
  }, [temporal])

  const assignmentByDay = useMemo(() => {
    const m = new Map<string, AssignmentMilestone[]>()
    for (const item of ASSIGNMENT_MILESTONES) {
      const arr = m.get(item.date) ?? []
      arr.push(item)
      m.set(item.date, arr)
    }
    return m
  }, [])

  const calendarCells = useMemo(() => {
    const y = calMonth.getFullYear()
    const m = calMonth.getMonth()
    const last = new Date(y, m + 1, 0).getDate()
    const firstWd = new Date(y, m, 1).getDay()
    const cells: {
      key: string; day: number | null; dateStr: string | null; count: number; milestones: AssignmentMilestone[]
    }[] = []
    for (let i = 0; i < firstWd; i++) {
      cells.push({ key: `pad-${i}`, day: null, dateStr: null, count: 0, milestones: [] })
    }
    const p2 = (n: number) => String(n).padStart(2, '0')
    for (let d = 1; d <= last; d++) {
      const ds = `${y}-${p2(m + 1)}-${p2(d)}`
      cells.push({
        key: ds,
        day: d,
        dateStr: ds,
        count: byDayMap.get(ds) ?? 0,
        milestones: assignmentByDay.get(ds) ?? [],
      })
    }
    return cells
  }, [calMonth, byDayMap, assignmentByDay])

  const maxDayCount = useMemo(() => {
    const rows = temporal?.tutor_usage.by_day ?? []
    if (!rows.length) return 1
    return Math.max(1, ...rows.map((r) => Number(r.count ?? 0)))
  }, [temporal])

  function dayCellBg(count: number): string {
    const t = maxDayCount > 0 ? count / maxDayCount : 0
    return `rgba(56, 189, 248, ${0.08 + t * 0.82})`
  }

  function milestoneKindColor(kind: AssignmentKind): string {
    if (kind === 'due') return 'bg-rose-400'
    if (kind === 'late') return 'bg-amber-400'
    return 'bg-cyan-400'
  }

  function milestoneKindLabel(kind: AssignmentKind): string {
    if (kind === 'due') return 'Due'
    if (kind === 'late') return 'Late'
    return 'Release'
  }

  async function handleExport() {
    try {
      const blob = await api.exportCsv()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'chatsight-labels.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm">
        Loading analysis…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-danger-text text-sm px-4 text-center">
        {error}
      </div>
    )
  }

  if (!summary) return null

  /** `label` = category (Y-axis). Avoid `name` on rows — it conflicts with Recharts `<Bar name="…">` for stacked series. */
  let freqData: { label: string; count: number; human: number; ai: number }[]
  if (labelFreqMode === 'human') {
    freqData = Object.entries(summary.human_label_counts)
      .map(([label, count]) => ({
        label,
        count: Number(count),
        human: Number(count),
        ai: 0,
      }))
      .sort((a, b) => b.count - a.count)
  } else if (labelFreqMode === 'ai') {
    freqData = Object.entries(summary.ai_label_counts)
      .map(([label, count]) => ({
        label,
        count: Number(count),
        human: 0,
        ai: Number(count),
      }))
      .sort((a, b) => b.count - a.count)
  } else {
    const names = new Set([
      ...Object.keys(summary.human_label_counts),
      ...Object.keys(summary.ai_label_counts),
      ...Object.keys(summary.label_counts),
    ])
    freqData = [...names]
      .map((label) => {
        const human = Number(summary.human_label_counts[label] ?? 0)
        const ai = Number(summary.ai_label_counts[label] ?? 0)
        const count = human + ai
        return { label, human, ai, count }
      })
      .sort((a, b) => b.count - a.count)
  }

  const freqChartMax = freqData.length ? Math.max(1, ...freqData.map((d) => d.count)) : 1

  const covTotal = Math.max(1, summary.coverage.total)
  const covHuman = summary.coverage.human_labeled
  const covAi = summary.coverage.ai_labeled
  const covUnlabeled = summary.coverage.unlabeled
  const pctOfTotal = (n: number) => (n / covTotal) * 100
  /** Stacked bar: scale if human+AI+unlabeled shares exceed 100% of total (rare overlap). */
  const rawBarPctSum = pctOfTotal(covHuman) + pctOfTotal(covAi) + pctOfTotal(covUnlabeled)
  const barScale = rawBarPctSum > 100 ? 100 / rawBarPctSum : 1
  const barPct = (n: number) => pctOfTotal(n) * barScale

  const posData = Object.entries(summary.position_distribution)
    .map(([label, buckets]) => ({
      label,
      early: buckets.early,
      mid: buckets.mid,
      late: buckets.late,
    }))
    .sort((a, b) => b.early + b.mid + b.late - (a.early + a.mid + a.late))
  const posMax = posData.length
    ? Math.max(...posData.flatMap((d) => [d.early, d.mid, d.late]))
    : 1

  const hourChartData =
    temporal?.tutor_usage.by_hour.map((h) => ({
      label: `${h.hour}:00`,
      hour: h.hour,
      count: Number(h.count ?? 0),
    })) ?? []

  const weekdayChartData =
    temporal?.tutor_usage.by_weekday.map((w) => ({
      weekday: WEEKDAY_SHORT[Number(w.weekday)] ?? String(w.weekday),
      count: Number(w.count ?? 0),
    })) ?? []

  const tutorUsageErr = temporal?.tutor_usage.error
  const tutorHourMax = hourChartData.length ? Math.max(...hourChartData.map((d) => d.count)) : 0
  const tutorWeekdayMax = weekdayChartData.length ? Math.max(...weekdayChartData.map((d) => d.count)) : 0
  const tutorUsageEmpty = !tutorUsageErr && tutorHourMax === 0 && tutorWeekdayMax === 0

  const throughputData = temporal?.labeling_throughput ?? []

  const hm = temporal?.notebook_label_heatmap
  let heatmapDisplay: number[][] = []
  if (hm) {
    if (heatmapMode === 'raw') {
      heatmapDisplay = hm.raw_counts.map((row) => row.map((v) => Number(v)))
    } else if (heatmapMode === 'row') {
      heatmapDisplay = hm.row_normalized
    } else {
      heatmapDisplay = hm.column_normalized
    }
  }

  const heatmapMaxRaw = hm
    ? Math.max(1, ...hm.raw_counts.flatMap((r) => r.map((x) => Number(x))))
    : 1

  function heatmapCellBg(value: number): string {
    if (heatmapMode === 'raw') {
      const t = heatmapMaxRaw > 0 ? value / heatmapMaxRaw : 0
      return `rgba(96, 165, 250, ${0.12 + t * 0.78})`
    }
    const t = Math.max(0, Math.min(1, value))
    return `rgba(96, 165, 250, ${0.12 + t * 0.78})`
  }

  return (
    <div className="flex-1 overflow-auto p-6 bg-canvas text-on-canvas min-h-0">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-on-canvas">Analysis</h1>
            <p className="text-sm text-faint mt-1">
              How student messages are labeled (human vs AI) across notebooks and conversation depth
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="px-4 py-2 rounded-lg bg-elevated hover:bg-elevated-hl text-sm text-on-canvas border border-edge"
          >
            Download CSV
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-start">
          <section className="rounded-xl border border-edge-subtle bg-surface/50 p-4 min-h-[280px]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-medium text-tertiary">Label Frequency</h2>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setLabelFreqMode('combined')}
                  className={`px-2 py-1 rounded border ${
                    labelFreqMode === 'combined'
                      ? 'bg-elevated-hl border-edge-strong text-on-canvas'
                      : 'bg-surface border-edge text-muted hover:border-edge-strong'
                  }`}
                >
                  Combined
                </button>
                <button
                  type="button"
                  onClick={() => setLabelFreqMode('human')}
                  className={`px-2 py-1 rounded border ${
                    labelFreqMode === 'human'
                      ? 'bg-elevated-hl border-edge-strong text-on-canvas'
                      : 'bg-surface border-edge text-muted hover:border-edge-strong'
                  }`}
                >
                  Human only
                </button>
                <button
                  type="button"
                  onClick={() => setLabelFreqMode('ai')}
                  className={`px-2 py-1 rounded border ${
                    labelFreqMode === 'ai'
                      ? 'bg-elevated-hl border-edge-strong text-on-canvas'
                      : 'bg-surface border-edge text-muted hover:border-edge-strong'
                  }`}
                >
                  AI only
                </button>
              </div>
            </div>
            {freqData.length === 0 ? (
              <p className="text-sm text-faint">
                No labels for this source yet.
              </p>
            ) : labelFreqMode === 'combined' ? (
              <div className="space-y-2">
                <p className="text-[10px] text-faint pl-[138px] pr-12">
                  Bar length is vs the largest label total (human + AI). Green / indigo split is the mix within that
                  label.
                </p>
                <div
                  className="max-h-[min(520px,60vh)] overflow-y-auto pr-1 space-y-1.5"
                  role="list"
                  aria-label="Label counts by human vs AI"
                >
                  {freqData.map((row) => {
                    const denom = row.count > 0 ? row.count : 1
                    const wHuman = (row.human / denom) * 100
                    const wAi = (row.ai / denom) * 100
                    const lenPct = row.count === 0 ? 0 : Math.max((row.count / freqChartMax) * 100, 1.2)
                    return (
                      <div key={row.label} className="flex items-center gap-2 text-xs min-h-[26px]">
                        <div
                          className="w-[130px] shrink-0 truncate text-tertiary text-right pr-1"
                          title={row.label}
                        >
                          {row.label}
                        </div>
                        <div className="flex-1 min-w-0 h-6 rounded-md bg-elevated/60 border border-edge-subtle/80 relative">
                          {row.count > 0 && (
                            <div
                              className="absolute left-0 top-0 bottom-0 flex rounded overflow-hidden border border-edge-subtle shadow-sm"
                              style={{
                                width: `${lenPct}%`,
                                minWidth: row.count > 0 ? 3 : 0,
                              }}
                              title={`${row.label}: human ${row.human}, AI ${row.ai}, total ${row.count} (${lenPct.toFixed(0)}% of max label)`}
                            >
                              {row.human > 0 && (
                                <div
                                  className="h-full bg-emerald-500 min-w-0 shrink-0"
                                  style={{ width: `${wHuman}%` }}
                                  title={`Human: ${row.human}`}
                                />
                              )}
                              {row.ai > 0 && (
                                <div
                                  className="h-full bg-indigo-500 min-w-0 shrink-0"
                                  style={{ width: `${wAi}%` }}
                                  title={`AI: ${row.ai}`}
                                />
                              )}
                            </div>
                          )}
                        </div>
                        <span className="w-10 shrink-0 text-right tabular-nums text-muted">
                          {row.count.toLocaleString()}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-4 pt-1 text-xs text-faint">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-sm bg-emerald-500" />
                    Human
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" />
                    AI
                  </span>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, freqData.length * 36)}>
                <BarChart data={freqData} layout="vertical" margin={{ left: 8, right: 16, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, freqChartMax]}
                    allowDecimals={false}
                    stroke="#737373"
                    tick={{ fill: '#a3a3a3', fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={130}
                    stroke="#737373"
                    tick={{ fill: '#a3a3a3', fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#171717', border: '1px solid #404040', borderRadius: 8 }}
                    labelStyle={{ color: '#e5e5e5' }}
                  />
                  <Bar
                    dataKey="count"
                    fill={labelFreqMode === 'human' ? '#22c55e' : '#6366f1'}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className="rounded-xl border border-edge-subtle bg-surface/50 p-4 min-h-[280px]">
            <h2 className="text-sm font-medium text-tertiary mb-1">Coverage</h2>
            <p className="text-xs text-faint mb-4">
              Share of all student messages in Postgres (<code className="text-muted">tutor_query</code> total).
              Human vs AI counts are unique messages with at least one label from that source.
            </p>
            <div className="space-y-4">
              <div
                className="flex h-10 w-full overflow-hidden rounded-lg border border-edge-subtle bg-surface"
                role="img"
                aria-label="Coverage stacked bar: human, AI, unlabeled"
              >
                <div
                  className="h-full bg-emerald-500 min-w-0 transition-[width] duration-300"
                  style={{ width: `${barPct(covHuman)}%` }}
                  title={`Human-labeled: ${covHuman}`}
                />
                <div
                  className="h-full bg-indigo-500 min-w-0 transition-[width] duration-300"
                  style={{ width: `${barPct(covAi)}%` }}
                  title={`AI-labeled: ${covAi}`}
                />
                <div
                  className="h-full bg-elevated-hl min-w-0 transition-[width] duration-300"
                  style={{ width: `${barPct(covUnlabeled)}%` }}
                  title={`Unlabeled: ${covUnlabeled}`}
                />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm bg-emerald-500" />
                  Human-labeled
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" />
                  AI-labeled
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm bg-elevated-hl" />
                  Unlabeled
                </span>
              </div>
              <div className="overflow-hidden rounded-lg border border-edge-subtle">
                <table className="w-full text-xs text-left">
                  <thead className="bg-surface/80 text-muted">
                    <tr>
                      <th className="p-2 font-medium">Category</th>
                      <th className="p-2 font-medium text-right tabular-nums">Count</th>
                      <th className="p-2 font-medium text-right tabular-nums">% of total</th>
                    </tr>
                  </thead>
                  <tbody className="text-on-surface">
                    <tr className="border-t border-edge-subtle">
                      <td className="p-2">Human-labeled</td>
                      <td className="p-2 text-right tabular-nums">{covHuman.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{pctOfTotal(covHuman).toFixed(1)}%</td>
                    </tr>
                    <tr className="border-t border-edge-subtle">
                      <td className="p-2">AI-labeled</td>
                      <td className="p-2 text-right tabular-nums">{covAi.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{pctOfTotal(covAi).toFixed(1)}%</td>
                    </tr>
                    <tr className="border-t border-edge-subtle">
                      <td className="p-2">Unlabeled</td>
                      <td className="p-2 text-right tabular-nums">{covUnlabeled.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{pctOfTotal(covUnlabeled).toFixed(1)}%</td>
                    </tr>
                    <tr className="border-t border-edge-subtle bg-surface/60 font-medium text-on-canvas">
                      <td className="p-2">Total messages</td>
                      <td className="p-2 text-right tabular-nums">{summary.coverage.total.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-edge-subtle bg-surface/50 p-4 min-h-[300px] lg:col-span-2">
            <h2 className="text-sm font-medium text-tertiary mb-4">Conversation Position</h2>
            {posData.length === 0 ? (
              <p className="text-sm text-faint">No position data yet.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-emerald-400" />
                    Early (0–2)
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-sky-400" />
                    Mid (3–6)
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-violet-400" />
                    Late (7+)
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[480px] overflow-y-auto pr-1">
                  {posData.map((row) => (
                    <div key={row.label} className="rounded-lg border border-edge-subtle bg-surface/60 p-3">
                      <p className="text-xs text-on-surface truncate mb-2" title={row.label}>{row.label}</p>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-[10px] text-muted">Early</span>
                          <div className="flex-1 h-2 rounded bg-elevated overflow-hidden">
                            <div className="h-full bg-emerald-400" style={{ width: `${(row.early / posMax) * 100}%` }} />
                          </div>
                          <span className="w-7 text-right text-[10px] text-tertiary tabular-nums">{row.early}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-[10px] text-muted">Mid</span>
                          <div className="flex-1 h-2 rounded bg-elevated overflow-hidden">
                            <div className="h-full bg-sky-400" style={{ width: `${(row.mid / posMax) * 100}%` }} />
                          </div>
                          <span className="w-7 text-right text-[10px] text-tertiary tabular-nums">{row.mid}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-[10px] text-muted">Late</span>
                          <div className="flex-1 h-2 rounded bg-elevated overflow-hidden">
                            <div className="h-full bg-violet-400" style={{ width: `${(row.late / posMax) * 100}%` }} />
                          </div>
                          <span className="w-7 text-right text-[10px] text-tertiary tabular-nums">{row.late}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-edge-subtle pt-8 space-y-6">
          <div>
            <h2 className="text-lg font-medium text-on-surface">Temporal &amp; usage context</h2>
            {temporal && (
              <p className="text-xs text-faint mt-1 max-w-3xl">{temporal.tutor_usage.timezone_note}</p>
            )}
            {temporalError && (
              <p className="text-sm text-warning mt-2">
                Temporal charts unavailable: {temporalError}
              </p>
            )}
            {temporalLoading && !temporal && (
              <p className="text-sm text-faint mt-2">Loading temporal analysis…</p>
            )}
          </div>

          {temporal && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className="rounded-xl border border-edge-subtle bg-surface/50 p-4 min-h-[260px]">
                  <h3 className="text-sm font-medium text-tertiary mb-4">Tutor usage (hour of day)</h3>
                  <p className="text-xs text-faint mb-2">
                    Aggregate student messages (<code className="text-muted">tutor_query</code>) from
                    Postgres. Hours are local wall clock in{' '}
                    <code className="text-muted">
                      {temporal.tutor_usage.display_timezone ?? 'America/Los_Angeles'}
                    </code>{' '}
                    (see note above).
                  </p>
                  {tutorUsageErr ? (
                    <p className="text-sm text-warning">{tutorUsageErr}</p>
                  ) : tutorUsageEmpty ? (
                    <p className="text-sm text-faint">
                      No <code className="text-muted">tutor_query</code> rows found — charts stay empty when
                      every hour is zero. Check port-forward and that the external DB has student messages.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={hourChartData} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis
                          dataKey="label"
                          stroke="#737373"
                          tick={{ fill: '#a3a3a3', fontSize: 9 }}
                          interval={2}
                        />
                        <YAxis
                          stroke="#737373"
                          tick={{ fill: '#a3a3a3', fontSize: 11 }}
                          domain={[0, (dataMax: number) => (dataMax > 0 ? Math.ceil(dataMax * 1.1) : 1)]}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#171717',
                            border: '1px solid #404040',
                            borderRadius: 8,
                          }}
                        />
                        <Bar
                          dataKey="count"
                          fill="#38bdf8"
                          background={false}
                          isAnimationActive={false}
                          radius={[0, 0, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </section>

                <section className="rounded-xl border border-edge-subtle bg-surface/50 p-4 min-h-[260px]">
                  <h3 className="text-sm font-medium text-tertiary mb-4">Tutor usage (day of week)</h3>
                  <p className="text-xs text-faint mb-2">
                    0 = Sunday … 6 = Saturday in{' '}
                    <code className="text-muted">
                      {temporal.tutor_usage.display_timezone ?? 'America/Los_Angeles'}
                    </code>
                    .
                  </p>
                  {tutorUsageErr ? (
                    <p className="text-sm text-warning">{tutorUsageErr}</p>
                  ) : tutorUsageEmpty ? (
                    <p className="text-sm text-faint">
                      Same data as the hour chart — when all counts are zero, bars have no height (nothing to see).
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={weekdayChartData} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis dataKey="weekday" stroke="#737373" tick={{ fill: '#a3a3a3', fontSize: 11 }} />
                        <YAxis
                          stroke="#737373"
                          tick={{ fill: '#a3a3a3', fontSize: 11 }}
                          domain={[0, (dataMax: number) => (dataMax > 0 ? Math.ceil(dataMax * 1.1) : 1)]}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#171717',
                            border: '1px solid #404040',
                            borderRadius: 8,
                          }}
                        />
                        <Bar
                          dataKey="count"
                          fill="#a78bfa"
                          background={false}
                          isAnimationActive={false}
                          radius={[0, 0, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </section>
              </div>

              <section className="rounded-xl border border-edge-subtle bg-surface/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-medium text-tertiary">Tutor usage (calendar)</h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Previous month"
                      onClick={() => setCalMonth((d) => addCalendarMonth(d, -1))}
                      className="px-2 py-1 rounded border border-edge bg-surface text-tertiary text-xs hover:bg-elevated"
                    >
                      ←
                    </button>
                    <span className="text-sm text-on-surface min-w-[11rem] text-center tabular-nums">
                      {calMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                    <button
                      type="button"
                      aria-label="Next month"
                      onClick={() => setCalMonth((d) => addCalendarMonth(d, 1))}
                      className="px-2 py-1 rounded border border-edge bg-surface text-tertiary text-xs hover:bg-elevated"
                    >
                      →
                    </button>
                  </div>
                </div>
                <p className="text-xs text-faint mb-3">
                  Daily <code className="text-muted">tutor_query</code> counts for the visible month (from
                  Postgres). Darker = more messages. Hover a date for tutor volume and assignment details.
                </p>
                {tutorUsageErr ? (
                  <p className="text-sm text-warning">{tutorUsageErr}</p>
                ) : temporalLoading ? (
                  <p className="text-sm text-faint">Updating calendar…</p>
                ) : (
                  <>
                    <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-faint mb-1">
                      {WEEKDAY_SHORT.map((d) => (
                        <div key={d}>{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1 overflow-visible">
                      {calendarCells.map((cell) =>
                        cell.day === null ? (
                          <div key={cell.key} className="min-h-[44px]" />
                        ) : (
                          <div
                            key={cell.key}
                            className="group relative min-h-[44px] rounded border border-edge/80 flex flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-on-canvas"
                            style={{ backgroundColor: dayCellBg(cell.count) }}
                            aria-label={`${cell.dateStr}: ${cell.count} tutor messages${
                              cell.milestones.length ? `; ${cell.milestones.length} assignment event(s)` : ''
                            }`}
                          >
                            <span className="text-[10px] text-muted leading-none">{cell.day}</span>
                            <span className="text-[11px] font-medium tabular-nums leading-none">{cell.count}</span>
                            {cell.milestones.length > 0 && (
                              <div className="flex items-center gap-0.5">
                                {cell.milestones.slice(0, 3).map((m, i) => (
                                  <span
                                    key={`${cell.key}-${m.title}-${i}`}
                                    className={`h-1.5 w-1.5 rounded-full ${milestoneKindColor(m.kind)}`}
                                  />
                                ))}
                                {cell.milestones.length > 3 && (
                                  <span className="text-[9px] text-tertiary leading-none">+{cell.milestones.length - 3}</span>
                                )}
                              </div>
                            )}
                            <div
                              className="pointer-events-none absolute left-1/2 z-50 w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-edge-strong bg-canvas px-2.5 py-2 text-left text-[10px] leading-snug text-on-surface shadow-xl opacity-0 shadow-black/40 transition-opacity duration-150 group-hover:opacity-100"
                              style={{ bottom: 'calc(100% + 6px)' }}
                              role="tooltip"
                            >
                              <div className="font-medium text-on-canvas">{cell.dateStr}</div>
                              <div className="text-muted">{cell.count} tutor messages</div>
                              {cell.milestones.length > 0 ? (
                                <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto border-t border-edge-subtle pt-1.5">
                                  {cell.milestones.map((m, i) => (
                                    <li key={`${cell.key}-tip-${m.title}-${i}`} className="flex gap-1.5">
                                      <span
                                        className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${milestoneKindColor(m.kind)}`}
                                      />
                                      <span>
                                        <span className="text-faint">{milestoneKindLabel(m.kind)}:</span>{' '}
                                        {m.title}
                                        {m.note ? <span className="text-faint"> — {m.note}</span> : null}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-1.5 border-t border-edge-subtle pt-1.5 text-faint">
                                  No assignment milestones on this date.
                                </p>
                              )}
                              <div className="pointer-events-none absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-neutral-600" />
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-400" />Due</span>
                      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />Late due</span>
                      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-400" />Release / posted</span>
                    </div>
                  </>
                )}
              </section>

              <section className="rounded-xl border border-edge-subtle bg-surface/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h3 className="text-sm font-medium text-tertiary">Notebook × label heatmap</h3>
                  <div className="flex gap-2 text-xs">
                    {(['raw', 'row', 'column'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setHeatmapMode(m)}
                        className={`px-2 py-1 rounded border ${
                          heatmapMode === m
                            ? 'bg-elevated-hl border-edge-strong text-on-canvas'
                            : 'bg-surface border-edge text-muted hover:border-edge-strong'
                        }`}
                      >
                        {m === 'raw' ? 'Raw counts' : m === 'row' ? 'Row %' : 'Column %'}
                      </button>
                    ))}
                  </div>
                </div>
                {!hm || hm.notebooks.length === 0 || hm.labels.length === 0 ? (
                  <p className="text-sm text-faint">
                    No notebook × label matrix yet (needs Postgres + labeled applications).
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse min-w-[320px]">
                      <thead>
                        <tr>
                          <th className="border border-edge bg-elevated/80 px-2 py-1.5 text-left text-muted font-medium">
                            Notebook
                          </th>
                          {hm.labels.map((lbl) => (
                            <th
                              key={lbl}
                              className="border border-edge bg-elevated/80 px-2 py-1.5 text-tertiary font-medium max-w-[140px]"
                            >
                              {lbl}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {hm.notebooks.map((nb, ri) => (
                          <tr key={nb}>
                            <td className="border border-edge bg-elevated/40 px-2 py-1.5 text-tertiary whitespace-nowrap">
                              {nb}
                            </td>
                            {hm.labels.map((lbl, ci) => {
                              const rawVal = hm.raw_counts[ri]?.[ci] ?? 0
                              const disp = heatmapDisplay[ri]?.[ci] ?? 0
                              const title =
                                heatmapMode === 'raw'
                                  ? `${rawVal} applications`
                                  : `${lbl} · ${nb}: raw ${rawVal}, ${heatmapMode === 'row' ? 'row' : 'column'} fraction ${disp.toFixed(3)}`
                              return (
                                <td
                                  key={lbl}
                                  className="border border-edge px-2 py-1.5 text-center text-on-surface tabular-nums"
                                  style={{ backgroundColor: heatmapCellBg(heatmapMode === 'raw' ? rawVal : disp) }}
                                  title={title}
                                >
                                  {heatmapMode === 'raw' ? rawVal : disp.toFixed(2)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-edge-subtle bg-surface/50 p-4 min-h-[280px]">
                <h3 className="text-sm font-medium text-tertiary mb-4">Labeling throughput</h3>
                <p className="text-xs text-faint mb-2">
                  SQLite <code className="text-muted">LabelApplication.created_at</code> by day —
                  human vs AI pipeline volume.
                </p>
                {throughputData.length === 0 ? (
                  <p className="text-sm text-faint">No labels with timestamps yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={throughputData} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="date" stroke="#737373" tick={{ fill: '#a3a3a3', fontSize: 10 }} />
                      <YAxis stroke="#737373" tick={{ fill: '#a3a3a3', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#171717', border: '1px solid #404040', borderRadius: 8 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="human" name="Human" stroke="#22c55e" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="ai" name="AI" stroke="#6366f1" strokeWidth={2} dot={false} />
                      <Line
                        type="monotone"
                        dataKey="total"
                        name="Total"
                        stroke="#737373"
                        strokeWidth={1}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
