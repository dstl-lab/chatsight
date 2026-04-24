import { useCallback, useEffect, useMemo, useState } from 'react'
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
import type { AnalysisSummary, LabelMessageSource, LabelMessagesResponse, TemporalAnalysis } from '../types'
import { api } from '../services/api'

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type HeatmapMode = 'raw' | 'row' | 'column'
type AssignmentKind = 'due' | 'late' | 'release'
type LabelFreqMode = 'combined' | 'human' | 'ai'
type PositionViewMode = 'all' | 'human' | 'ai' | 'split'

interface PosRow {
  label: string
  early: number
  mid: number
  late: number
}

interface PosSplitRow {
  label: string
  earlyH: number
  earlyA: number
  midH: number
  midA: number
  lateH: number
  lateA: number
}

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
  const [positionViewMode, setPositionViewMode] = useState<PositionViewMode>('all')
  const [exportAppliedBy, setExportAppliedBy] = useState<'all' | 'human' | 'ai'>('all')
  const [exportDateFrom, setExportDateFrom] = useState('')
  const [exportDateTo, setExportDateTo] = useState('')
  const [labelMsgModal, setLabelMsgModal] = useState<null | { label: string; source: LabelMessageSource }>(null)
  const [labelMsgData, setLabelMsgData] = useState<LabelMessagesResponse | null>(null)
  const [labelMsgLoading, setLabelMsgLoading] = useState(false)
  const [labelMsgError, setLabelMsgError] = useState<string | null>(null)
  /** `chatlog_id-message_index` → expanded full preview in modal */
  const [expandedLabelMsgKeys, setExpandedLabelMsgKeys] = useState<Record<string, boolean>>({})

  const positionBlock = useMemo(() => {
    if (!summary) return null
    const distAll = summary.position_distribution
    const distH = summary.position_distribution_human ?? {}
    const distA = summary.position_distribution_ai ?? {}
    const labelNames = new Set([
      ...Object.keys(distAll),
      ...Object.keys(distH),
      ...Object.keys(distA),
    ])
    const posDataAll: PosRow[] = [...labelNames]
      .map((label) => {
        const b = distAll[label] ?? { early: 0, mid: 0, late: 0 }
        return { label, early: b.early, mid: b.mid, late: b.late }
      })
      .sort((a, b) => b.early + b.mid + b.late - (a.early + a.mid + a.late))
    const posMax = posDataAll.length
      ? Math.max(...posDataAll.flatMap((d) => [d.early, d.mid, d.late]))
      : 1
    const fromDist = (dist: Record<string, { early: number; mid: number; late: number }>): PosRow[] =>
      [...labelNames]
        .map((label) => {
          const b = dist[label] ?? { early: 0, mid: 0, late: 0 }
          return { label, early: b.early, mid: b.mid, late: b.late }
        })
        .sort((a, b) => b.early + b.mid + b.late - (a.early + a.mid + a.late))
    const posSplitData: PosSplitRow[] = [...labelNames]
      .map((label) => ({
        label,
        earlyH: distH[label]?.early ?? 0,
        earlyA: distA[label]?.early ?? 0,
        midH: distH[label]?.mid ?? 0,
        midA: distA[label]?.mid ?? 0,
        lateH: distH[label]?.late ?? 0,
        lateA: distA[label]?.late ?? 0,
      }))
      .sort((a, b) => {
        const ta = a.earlyH + a.earlyA + a.midH + a.midA + a.lateH + a.lateA
        const tb = b.earlyH + b.earlyA + b.midH + b.midA + b.lateH + b.lateA
        return tb - ta
      })
    return {
      posDataAll,
      posDataHuman: fromDist(distH),
      posDataAi: fromDist(distA),
      posSplitData,
      posMax,
    }
  }, [summary])

  const labelSourceRows = useMemo(() => {
    if (!summary?.label_source_mix) return []
    return Object.entries(summary.label_source_mix)
      .map(([label, m]) => ({
        label,
        human_only: m.human_only,
        ai_only: m.ai_only,
        both: m.both,
        total: m.human_only + m.ai_only + m.both,
      }))
      .sort((a, b) => b.total - a.total)
  }, [summary])

  const openLabelMessages = useCallback((label: string, source: LabelMessageSource) => {
    setExpandedLabelMsgKeys({})
    setLabelMsgModal({ label, source })
    setLabelMsgData(null)
    setLabelMsgError(null)
    setLabelMsgLoading(true)
    void api
      .getAnalysisLabelMessages({ labelName: label, source })
      .then((d) => setLabelMsgData(d))
      .catch((e) => setLabelMsgError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLabelMsgLoading(false))
  }, [])

  const closeLabelMessages = useCallback(() => {
    setLabelMsgModal(null)
    setLabelMsgData(null)
    setLabelMsgError(null)
    setLabelMsgLoading(false)
    setExpandedLabelMsgKeys({})
  }, [])

  useEffect(() => {
    if (!labelMsgModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLabelMessages()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [labelMsgModal, closeLabelMessages])

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
      const useDates = exportDateFrom && exportDateTo
      const blob = await api.exportCsv({
        appliedBy: exportAppliedBy === 'all' ? undefined : exportAppliedBy,
        calendarFrom: useDates ? exportDateFrom : undefined,
        calendarTo: useDates ? exportDateTo : undefined,
      })
      let fname = 'chatsight-labels.csv'
      if (exportAppliedBy === 'human') fname = 'chatsight-labels-human.csv'
      else if (exportAppliedBy === 'ai') fname = 'chatsight-labels-ai.csv'
      if (useDates) {
        fname = fname.replace('.csv', `-${exportDateFrom}_to_${exportDateTo}.csv`)
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fname
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
        Loading analysis…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-4 text-center">
        {error}
      </div>
    )
  }

  if (!summary || !positionBlock) return null

  const { posDataAll, posDataHuman, posDataAi, posSplitData, posMax } = positionBlock
  const posData: PosRow[] =
    positionViewMode === 'all'
      ? posDataAll
      : positionViewMode === 'human'
        ? posDataHuman
        : positionViewMode === 'ai'
          ? posDataAi
          : posDataAll

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
    <>
    <div className="flex-1 overflow-auto p-6 bg-neutral-950 text-neutral-100 min-h-0">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-neutral-100">Analysis</h1>
            <p className="text-sm text-neutral-500 mt-1">
              How student messages are labeled (human vs AI) across notebooks and conversation depth
            </p>
            <details className="mt-2 text-xs text-neutral-500 max-w-3xl">
              <summary className="cursor-pointer text-neutral-400 hover:text-neutral-300 select-none">
                How to read these metrics
              </summary>
              <div className="mt-2 space-y-2 pl-1 border-l border-neutral-800 text-neutral-400 leading-relaxed">
                <p>
                  <span className="text-neutral-300">Applications</span> are individual label placements on a
                  message. One student message can have several labels and both human and AI rows over time.
                </p>
                <p>
                  <span className="text-neutral-300">Coverage</span> counts distinct messages that have at least one
                  human-labeled application and/or at least one AI-labeled application. The same message can count
                  toward both; the stacked bar is scaled so human + AI + unlabeled fits the bar when those shares sum
                  to more than 100% of all tutor messages.
                </p>
                <p>
                  <span className="text-neutral-300">Label frequency (combined)</span> uses human + AI application
                  counts per label (not deduped when both sources applied the same label to the same message).
                </p>
                <p>
                  <span className="text-neutral-300">Messages per label (table below)</span> dedupes by message:
                  human-only / AI-only / both shows how many distinct messages received that label from only humans,
                  only AI, or both.
                </p>
                <p className="text-neutral-500">
                  Full roadmap: <code className="text-neutral-400">ANALYSIS_AI_VS_HUMAN_PLAN.md</code> in the repo.
                </p>
              </div>
            </details>
          </div>
          <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-2 justify-end text-xs">
              <label className="text-neutral-500 whitespace-nowrap">CSV source</label>
              <select
                value={exportAppliedBy}
                onChange={(e) => setExportAppliedBy(e.target.value as 'all' | 'human' | 'ai')}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-neutral-200"
              >
                <option value="all">All applications</option>
                <option value="human">Human only</option>
                <option value="ai">AI only</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end text-xs">
              <label className="text-neutral-500 whitespace-nowrap">Date range (optional)</label>
              <input
                type="date"
                value={exportDateFrom}
                onChange={(e) => setExportDateFrom(e.target.value)}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
                aria-label="Export from date"
              />
              <span className="text-neutral-600">–</span>
              <input
                type="date"
                value={exportDateTo}
                onChange={(e) => setExportDateTo(e.target.value)}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200"
                aria-label="Export to date"
              />
            </div>
            <button
              type="button"
              onClick={handleExport}
              className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-100 border border-neutral-700"
            >
              Download CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-start">
          <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 min-h-[280px]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-medium text-neutral-300">Label Frequency</h2>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setLabelFreqMode('combined')}
                  className={`px-2 py-1 rounded border ${
                    labelFreqMode === 'combined'
                      ? 'bg-neutral-700 border-neutral-500 text-neutral-100'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-600'
                  }`}
                >
                  Combined
                </button>
                <button
                  type="button"
                  onClick={() => setLabelFreqMode('human')}
                  className={`px-2 py-1 rounded border ${
                    labelFreqMode === 'human'
                      ? 'bg-neutral-700 border-neutral-500 text-neutral-100'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-600'
                  }`}
                >
                  Human only
                </button>
                <button
                  type="button"
                  onClick={() => setLabelFreqMode('ai')}
                  className={`px-2 py-1 rounded border ${
                    labelFreqMode === 'ai'
                      ? 'bg-neutral-700 border-neutral-500 text-neutral-100'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-600'
                  }`}
                >
                  AI only
                </button>
              </div>
            </div>
            {freqData.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No labels for this source yet.
              </p>
            ) : labelFreqMode === 'combined' ? (
              <div className="space-y-2">
                <p className="text-[10px] text-neutral-500 pl-[138px] pr-12">
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
                          className="w-[130px] shrink-0 truncate text-neutral-300 text-right pr-1"
                          title={row.label}
                        >
                          {row.label}
                        </div>
                        <div className="flex-1 min-w-0 h-6 rounded-md bg-neutral-800/60 border border-neutral-800/80 relative">
                          {row.count > 0 && (
                            <div
                              className="absolute left-0 top-0 bottom-0 flex rounded overflow-hidden border border-neutral-800 shadow-sm"
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
                        <span className="w-10 shrink-0 text-right tabular-nums text-neutral-400">
                          {row.count.toLocaleString()}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-4 pt-1 text-xs text-neutral-500">
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

          <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 min-h-[280px]">
            <h2 className="text-sm font-medium text-neutral-300 mb-1">Coverage</h2>
            <p className="text-xs text-neutral-500 mb-4">
              Share of all student messages in Postgres (<code className="text-neutral-400">tutor_query</code> total).
              Human vs AI counts are unique messages with at least one label from that source.
            </p>
            <div className="space-y-4">
              <div
                className="flex h-10 w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900"
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
                  className="h-full bg-neutral-600 min-w-0 transition-[width] duration-300"
                  style={{ width: `${barPct(covUnlabeled)}%` }}
                  title={`Unlabeled: ${covUnlabeled}`}
                />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-neutral-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm bg-emerald-500" />
                  Human-labeled
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" />
                  AI-labeled
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm bg-neutral-600" />
                  Unlabeled
                </span>
              </div>
              <div className="overflow-hidden rounded-lg border border-neutral-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-neutral-900/80 text-neutral-400">
                    <tr>
                      <th className="p-2 font-medium">Category</th>
                      <th className="p-2 font-medium text-right tabular-nums">Count</th>
                      <th className="p-2 font-medium text-right tabular-nums">% of total</th>
                    </tr>
                  </thead>
                  <tbody className="text-neutral-200">
                    <tr className="border-t border-neutral-800">
                      <td className="p-2">Human-labeled</td>
                      <td className="p-2 text-right tabular-nums">{covHuman.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{pctOfTotal(covHuman).toFixed(1)}%</td>
                    </tr>
                    <tr className="border-t border-neutral-800">
                      <td className="p-2">AI-labeled</td>
                      <td className="p-2 text-right tabular-nums">{covAi.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{pctOfTotal(covAi).toFixed(1)}%</td>
                    </tr>
                    <tr className="border-t border-neutral-800">
                      <td className="p-2">Unlabeled</td>
                      <td className="p-2 text-right tabular-nums">{covUnlabeled.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">{pctOfTotal(covUnlabeled).toFixed(1)}%</td>
                    </tr>
                    <tr className="border-t border-neutral-800 bg-neutral-900/60 font-medium text-neutral-100">
                      <td className="p-2">Total messages</td>
                      <td className="p-2 text-right tabular-nums">{summary.coverage.total.toLocaleString()}</td>
                      <td className="p-2 text-right tabular-nums">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 lg:col-span-2">
            <h2 className="text-sm font-medium text-neutral-300 mb-1">Messages per label (human vs AI)</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Distinct student messages that have this label: only from humans, only from AI, or from both (same
              message, same label name). Click a green or purple count to open message previews (truncated in each
              row; hover for full text when cached).
            </p>
            {labelSourceRows.length === 0 ? (
              <p className="text-sm text-neutral-500">No label applications yet.</p>
            ) : (
              <div className="overflow-x-auto max-h-[min(320px,50vh)] overflow-y-auto rounded-lg border border-neutral-800">
                <table className="w-full text-xs text-left min-w-[520px]">
                  <thead className="sticky top-0 bg-neutral-900/95 text-neutral-400 z-10">
                    <tr>
                      <th className="p-2 font-medium">Label</th>
                      <th className="p-2 font-medium text-right tabular-nums">Human-only</th>
                      <th className="p-2 font-medium text-right tabular-nums">AI-only</th>
                      <th className="p-2 font-medium text-right tabular-nums">Both</th>
                      <th className="p-2 font-medium text-right tabular-nums">Messages</th>
                    </tr>
                  </thead>
                  <tbody className="text-neutral-200">
                    {labelSourceRows.map((r) => (
                      <tr key={r.label} className="border-t border-neutral-800">
                        <td className="p-2 max-w-[200px] truncate" title={r.label}>
                          {r.label}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {r.human_only > 0 ? (
                            <button
                              type="button"
                              onClick={() => openLabelMessages(r.label, 'human_only')}
                              className="text-emerald-400/90 hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit tabular-nums"
                            >
                              {r.human_only.toLocaleString()}
                            </button>
                          ) : (
                            <span className="text-emerald-400/35">0</span>
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {r.ai_only > 0 ? (
                            <button
                              type="button"
                              onClick={() => openLabelMessages(r.label, 'ai_only')}
                              className="text-indigo-400/90 hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit tabular-nums"
                            >
                              {r.ai_only.toLocaleString()}
                            </button>
                          ) : (
                            <span className="text-indigo-400/35">0</span>
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {r.both > 0 ? (
                            <button
                              type="button"
                              onClick={() => openLabelMessages(r.label, 'both')}
                              className="text-neutral-200 hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit tabular-nums"
                            >
                              {r.both.toLocaleString()}
                            </button>
                          ) : (
                            <span className="text-neutral-500">0</span>
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums font-medium text-neutral-100">
                          {r.total.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 min-h-[300px] lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-medium text-neutral-300">Conversation Position</h2>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {(['all', 'human', 'ai', 'split'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPositionViewMode(m)}
                    className={`px-2 py-1 rounded border ${
                      positionViewMode === m
                        ? 'bg-neutral-700 border-neutral-500 text-neutral-100'
                        : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-600'
                    }`}
                  >
                    {m === 'all' ? 'All apps' : m === 'human' ? 'Human' : m === 'ai' ? 'AI' : 'Human + AI'}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-neutral-500 mb-3">
              {positionViewMode === 'split'
                ? 'Per message index bucket: emerald = human applications, indigo = AI. Bar length uses the same scale as “All apps”.'
                : positionViewMode === 'all'
                  ? 'Application counts by transcript index (0–2 early, 3–6 mid, 7+ late), all sources.'
                  : `Applications in each bucket from ${positionViewMode === 'human' ? 'human' : 'AI'} labeling only.`}
            </p>
            {(positionViewMode === 'split' ? posSplitData.length === 0 : posData.length === 0) ? (
              <p className="text-sm text-neutral-500">No position data yet.</p>
            ) : positionViewMode === 'split' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-emerald-500" />
                    Human
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-indigo-500" />
                    AI
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[480px] overflow-y-auto pr-1">
                  {posSplitData.map((row) => (
                    <div key={row.label} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
                      <p className="text-xs text-neutral-200 truncate mb-2" title={row.label}>
                        {row.label}
                      </p>
                      <div className="space-y-1.5">
                        {(
                          [
                            ['Early', row.earlyH, row.earlyA],
                            ['Mid', row.midH, row.midA],
                            ['Late', row.lateH, row.lateA],
                          ] as const
                        ).map(([label, h, a]) => {
                          const t = h + a
                          const outerPct = posMax > 0 ? (t / posMax) * 100 : 0
                          const wH = t > 0 ? (h / t) * 100 : 0
                          const wA = t > 0 ? (a / t) * 100 : 0
                          return (
                            <div key={label} className="flex items-center gap-2">
                              <span className="w-12 text-[10px] text-neutral-400">{label}</span>
                              <div className="flex-1 h-2 rounded bg-neutral-800 overflow-hidden flex justify-start min-w-0">
                                {t > 0 && (
                                  <div
                                    className="h-full flex rounded overflow-hidden shrink-0"
                                    style={{ width: `${outerPct}%`, minWidth: h + a > 0 ? 3 : 0 }}
                                    title={`${label}: human ${h}, AI ${a}`}
                                  >
                                    {h > 0 && (
                                      <div className="h-full bg-emerald-500 min-w-0" style={{ width: `${wH}%` }} />
                                    )}
                                    {a > 0 && (
                                      <div className="h-full bg-indigo-500 min-w-0" style={{ width: `${wA}%` }} />
                                    )}
                                  </div>
                                )}
                              </div>
                              <span
                                className="w-10 text-right text-[10px] text-neutral-300 tabular-nums shrink-0"
                                title={`human ${h}, AI ${a}`}
                              >
                                {t}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400">
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
                  {posData.map((row) => {
                    const earlyC =
                      positionViewMode === 'human' ? 'bg-emerald-400' : positionViewMode === 'ai' ? 'bg-indigo-400' : 'bg-emerald-400'
                    const midC =
                      positionViewMode === 'human' ? 'bg-emerald-500' : positionViewMode === 'ai' ? 'bg-indigo-500' : 'bg-sky-400'
                    const lateC =
                      positionViewMode === 'human' ? 'bg-emerald-600' : positionViewMode === 'ai' ? 'bg-violet-500' : 'bg-violet-400'
                    return (
                      <div key={row.label} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
                        <p className="text-xs text-neutral-200 truncate mb-2" title={row.label}>
                          {row.label}
                        </p>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-[10px] text-neutral-400">Early</span>
                            <div className="flex-1 h-2 rounded bg-neutral-800 overflow-hidden">
                              <div className={`h-full ${earlyC}`} style={{ width: `${(row.early / posMax) * 100}%` }} />
                            </div>
                            <span className="w-7 text-right text-[10px] text-neutral-300 tabular-nums">{row.early}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-[10px] text-neutral-400">Mid</span>
                            <div className="flex-1 h-2 rounded bg-neutral-800 overflow-hidden">
                              <div className={`h-full ${midC}`} style={{ width: `${(row.mid / posMax) * 100}%` }} />
                            </div>
                            <span className="w-7 text-right text-[10px] text-neutral-300 tabular-nums">{row.mid}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-[10px] text-neutral-400">Late</span>
                            <div className="flex-1 h-2 rounded bg-neutral-800 overflow-hidden">
                              <div className={`h-full ${lateC}`} style={{ width: `${(row.late / posMax) * 100}%` }} />
                            </div>
                            <span className="w-7 text-right text-[10px] text-neutral-300 tabular-nums">{row.late}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-neutral-800 pt-8 space-y-6">
          <div>
            <h2 className="text-lg font-medium text-neutral-200">Temporal &amp; usage context</h2>
            {temporal && (
              <p className="text-xs text-neutral-500 mt-1 max-w-3xl">{temporal.tutor_usage.timezone_note}</p>
            )}
            {temporalError && (
              <p className="text-sm text-amber-500/90 mt-2">
                Temporal charts unavailable: {temporalError}
              </p>
            )}
            {temporalLoading && !temporal && (
              <p className="text-sm text-neutral-500 mt-2">Loading temporal analysis…</p>
            )}
          </div>

          {temporal && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 min-h-[260px]">
                  <h3 className="text-sm font-medium text-neutral-300 mb-4">Tutor usage (hour of day)</h3>
                  <p className="text-xs text-neutral-500 mb-2">
                    Aggregate student messages (<code className="text-neutral-400">tutor_query</code>) from
                    Postgres. Hours are local wall clock in{' '}
                    <code className="text-neutral-400">
                      {temporal.tutor_usage.display_timezone ?? 'America/Los_Angeles'}
                    </code>{' '}
                    (see note above).
                  </p>
                  {tutorUsageErr ? (
                    <p className="text-sm text-amber-500/90">{tutorUsageErr}</p>
                  ) : tutorUsageEmpty ? (
                    <p className="text-sm text-neutral-500">
                      No <code className="text-neutral-400">tutor_query</code> rows found — charts stay empty when
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

                <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 min-h-[260px]">
                  <h3 className="text-sm font-medium text-neutral-300 mb-4">Tutor usage (day of week)</h3>
                  <p className="text-xs text-neutral-500 mb-2">
                    0 = Sunday … 6 = Saturday in{' '}
                    <code className="text-neutral-400">
                      {temporal.tutor_usage.display_timezone ?? 'America/Los_Angeles'}
                    </code>
                    .
                  </p>
                  {tutorUsageErr ? (
                    <p className="text-sm text-amber-500/90">{tutorUsageErr}</p>
                  ) : tutorUsageEmpty ? (
                    <p className="text-sm text-neutral-500">
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

              <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-medium text-neutral-300">Tutor usage (calendar)</h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Previous month"
                      onClick={() => setCalMonth((d) => addCalendarMonth(d, -1))}
                      className="px-2 py-1 rounded border border-neutral-700 bg-neutral-900 text-neutral-300 text-xs hover:bg-neutral-800"
                    >
                      ←
                    </button>
                    <span className="text-sm text-neutral-200 min-w-[11rem] text-center tabular-nums">
                      {calMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                    <button
                      type="button"
                      aria-label="Next month"
                      onClick={() => setCalMonth((d) => addCalendarMonth(d, 1))}
                      className="px-2 py-1 rounded border border-neutral-700 bg-neutral-900 text-neutral-300 text-xs hover:bg-neutral-800"
                    >
                      →
                    </button>
                  </div>
                </div>
                <p className="text-xs text-neutral-500 mb-3">
                  Daily <code className="text-neutral-400">tutor_query</code> counts for the visible month (from
                  Postgres). Darker = more messages. Hover a date for tutor volume and assignment details.
                </p>
                {tutorUsageErr ? (
                  <p className="text-sm text-amber-500/90">{tutorUsageErr}</p>
                ) : temporalLoading ? (
                  <p className="text-sm text-neutral-500">Updating calendar…</p>
                ) : (
                  <>
                    <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
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
                            className="group relative min-h-[44px] rounded border border-neutral-700/80 flex flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-neutral-100"
                            style={{ backgroundColor: dayCellBg(cell.count) }}
                            aria-label={`${cell.dateStr}: ${cell.count} tutor messages${
                              cell.milestones.length ? `; ${cell.milestones.length} assignment event(s)` : ''
                            }`}
                          >
                            <span className="text-[10px] text-neutral-400 leading-none">{cell.day}</span>
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
                                  <span className="text-[9px] text-neutral-300 leading-none">+{cell.milestones.length - 3}</span>
                                )}
                              </div>
                            )}
                            <div
                              className="pointer-events-none absolute left-1/2 z-50 w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-neutral-600 bg-neutral-950 px-2.5 py-2 text-left text-[10px] leading-snug text-neutral-200 shadow-xl opacity-0 shadow-black/40 transition-opacity duration-150 group-hover:opacity-100"
                              style={{ bottom: 'calc(100% + 6px)' }}
                              role="tooltip"
                            >
                              <div className="font-medium text-neutral-100">{cell.dateStr}</div>
                              <div className="text-neutral-400">{cell.count} tutor messages</div>
                              {cell.milestones.length > 0 ? (
                                <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto border-t border-neutral-800 pt-1.5">
                                  {cell.milestones.map((m, i) => (
                                    <li key={`${cell.key}-tip-${m.title}-${i}`} className="flex gap-1.5">
                                      <span
                                        className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${milestoneKindColor(m.kind)}`}
                                      />
                                      <span>
                                        <span className="text-neutral-500">{milestoneKindLabel(m.kind)}:</span>{' '}
                                        {m.title}
                                        {m.note ? <span className="text-neutral-500"> — {m.note}</span> : null}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-1.5 border-t border-neutral-800 pt-1.5 text-neutral-500">
                                  No assignment milestones on this date.
                                </p>
                              )}
                              <div className="pointer-events-none absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-neutral-600" />
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-neutral-400">
                      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-400" />Due</span>
                      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />Late due</span>
                      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-400" />Release / posted</span>
                    </div>
                  </>
                )}
              </section>

              <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h3 className="text-sm font-medium text-neutral-300">Notebook × label heatmap</h3>
                  <div className="flex gap-2 text-xs">
                    {(['raw', 'row', 'column'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setHeatmapMode(m)}
                        className={`px-2 py-1 rounded border ${
                          heatmapMode === m
                            ? 'bg-neutral-700 border-neutral-500 text-neutral-100'
                            : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-600'
                        }`}
                      >
                        {m === 'raw' ? 'Raw counts' : m === 'row' ? 'Row %' : 'Column %'}
                      </button>
                    ))}
                  </div>
                </div>
                {!hm || hm.notebooks.length === 0 || hm.labels.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    No notebook × label matrix yet (needs Postgres + labeled applications).
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse min-w-[320px]">
                      <thead>
                        <tr>
                          <th className="border border-neutral-700 bg-neutral-800/80 px-2 py-1.5 text-left text-neutral-400 font-medium">
                            Notebook
                          </th>
                          {hm.labels.map((lbl) => (
                            <th
                              key={lbl}
                              className="border border-neutral-700 bg-neutral-800/80 px-2 py-1.5 text-neutral-300 font-medium max-w-[140px]"
                            >
                              {lbl}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {hm.notebooks.map((nb, ri) => (
                          <tr key={nb}>
                            <td className="border border-neutral-700 bg-neutral-800/40 px-2 py-1.5 text-neutral-300 whitespace-nowrap">
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
                                  className="border border-neutral-700 px-2 py-1.5 text-center text-neutral-200 tabular-nums"
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

              <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 min-h-[280px]">
                <h3 className="text-sm font-medium text-neutral-300 mb-4">Labeling throughput</h3>
                <p className="text-xs text-neutral-500 mb-2">
                  SQLite <code className="text-neutral-400">LabelApplication.created_at</code> by day —
                  human vs AI pipeline volume.
                </p>
                {throughputData.length === 0 ? (
                  <p className="text-sm text-neutral-500">No labels with timestamps yet.</p>
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

    {labelMsgModal && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeLabelMessages()
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="label-msg-modal-title"
          className="w-full max-w-2xl max-h-[min(80vh,640px)] flex flex-col rounded-xl border border-neutral-700 bg-neutral-950 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-4 py-3 shrink-0">
            <div className="min-w-0">
              <h2 id="label-msg-modal-title" className="text-sm font-semibold text-neutral-100 truncate">
                {labelMsgModal.source === 'human_only'
                  ? 'Human-only'
                  : labelMsgModal.source === 'ai_only'
                    ? 'AI-only'
                    : 'Both sources'}{' '}
                — {labelMsgModal.label}
              </h2>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Student message text from local cache when available. Click a row to expand or collapse the full
                message.
              </p>
            </div>
            <button
              type="button"
              onClick={closeLabelMessages}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 border border-transparent hover:border-neutral-700"
              aria-label="Close"
            >
              Close
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
            {labelMsgLoading && <p className="text-sm text-neutral-500 py-6 text-center">Loading…</p>}
            {labelMsgError && (
              <p className="text-sm text-red-400/90 py-4">{labelMsgError}</p>
            )}
            {!labelMsgLoading && !labelMsgError && labelMsgData && (
              <>
                <p className="text-[11px] text-neutral-500 mb-2">
                  Showing {labelMsgData.returned_count.toLocaleString()} of{' '}
                  {labelMsgData.total_count.toLocaleString()} messages
                  {labelMsgData.truncated ? ' (list capped — export CSV for full data).' : '.'}
                </p>
                {labelMsgData.messages.length === 0 ? (
                  <p className="text-sm text-neutral-500 py-4">No messages in this bucket.</p>
                ) : (
                  <ul className="space-y-0 divide-y divide-neutral-800/90">
                    {labelMsgData.messages.map((m) => {
                      const rowKey = `${m.chatlog_id}-${m.message_index}`
                      const expanded = !!expandedLabelMsgKeys[rowKey]
                      const hasPreview = Boolean(m.preview?.trim())
                      return (
                        <li key={rowKey} className="flex items-start gap-3 py-2 text-xs">
                          <span className="shrink-0 w-[5.5rem] tabular-nums text-neutral-500 pt-0.5">
                            #{m.chatlog_id}·{m.message_index}
                          </span>
                          {hasPreview ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedLabelMsgKeys((prev) => ({
                                  ...prev,
                                  [rowKey]: !prev[rowKey],
                                }))
                              }
                              className={`min-w-0 flex-1 text-left rounded px-1 -mx-1 py-0.5 text-neutral-200 cursor-pointer hover:bg-neutral-800/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500 ${
                                expanded ? 'whitespace-pre-wrap break-words' : 'truncate'
                              }`}
                              title={
                                expanded
                                  ? 'Click to collapse to one line'
                                  : 'Click to show full message (or click the … when text is cut off)'
                              }
                            >
                              {m.preview}
                            </button>
                          ) : (
                            <span className="min-w-0 flex-1 text-neutral-500">—</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  )
}
