import type { ReadinessState } from '../../types'

interface Props {
  state: ReadinessState
}

export function ReadinessGauge({ state }: Props) {
  const tier =
    state.yes_count === 0 || state.no_count === 0
      ? 'gray'
      : state.conversations_walked < 5
        ? 'amber'
        : 'green'

  const color = {
    gray: 'bg-neutral-600',
    amber: 'bg-amber-500',
    green: 'bg-emerald-500',
  }[tier]

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`inline-block w-3 h-3 rounded-full ${color}`} />
      <span data-testid="readiness-tier" className="hidden">{tier}</span>
      <span className="text-neutral-300">
        {state.yes_count} yes / {state.no_count} no / {state.skip_count} skip
      </span>
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-300">
        {state.conversations_walked}/{state.total_conversations} convos walked
      </span>
    </div>
  )
}
