import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { api } from '../../services/api'
import type { OnboardingStarter } from '../../types'

const DISMISS_KEY = 'chatsight_onboarding_skipped'

export function onboardingSkipped(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function skipOnboardingTutorial(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* ignore */
  }
}

interface Props {
  onStarted: () => void
  onSkipTutorial: () => void
}

export function OnboardingModal({ onStarted, onSkipTutorial }: Props) {
  const [starter, setStarter] = useState<OnboardingStarter | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getOnboardingStarter()
      .then(setStarter)
      .catch(() =>
        setError('Could not load a starter conversation. Is the backend running with messages cached?'),
      )
      .finally(() => setLoading(false))
  }, [])

  const start = async () => {
    if (!name.trim() || !starter) return
    setBusy(true)
    try {
      const created = await api.createSingleLabel({
        name: name.trim(),
        seed_chatlog_id: starter.chatlog_id,
        seed_message_index: starter.seed_message_index,
      })
      await api.activateSingleLabel(created.id)
      onStarted()
    } finally {
      setBusy(false)
    }
  }

  const handleSkip = () => {
    skipOnboardingTutorial()
    onSkipTutorial()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        skipOnboardingTutorial()
        onSkipTutorial()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkipTutorial])

  const suggestionHint =
    starter?.suggestions_source === 'ai'
      ? 'AI-suggested label names (click to use — not created until you start)'
      : 'Example label names (click to use — not created until you start)'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div
        className="bg-bg-warm border border-edge rounded-xl max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-edge-subtle">
          <h2 className="font-serif text-2xl text-on-canvas tracking-tight">
            Create your first label
          </h2>
          <p className="font-serif text-sm text-muted mt-2 leading-relaxed">
            You will mark each student message <strong className="text-on-canvas font-normal">Yes</strong>{' '}
            or <strong className="text-on-canvas font-normal">No</strong> for one label at a time.
            Descriptions can be added later.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <ul className="font-serif text-sm text-muted space-y-1.5 list-none">
            <li>
              <span className="text-ochre font-mono text-[10px] mr-2">1</span>
              Skim the starter conversation below.
            </li>
            <li>
              <span className="text-ochre font-mono text-[10px] mr-2">2</span>
              Type a <strong className="text-on-canvas font-normal">label name</strong> (or click an example).
            </li>
            <li>
              <span className="text-ochre font-mono text-[10px] mr-2">3</span>
              Label with Yes / No; AI can help after enough examples.
            </li>
          </ul>

          {loading && (
            <p className="text-xs text-faint font-mono uppercase tracking-widest animate-pulse">
              Picking a starter conversation…
            </p>
          )}

          {error && (
            <div className="text-sm">
              <p className="text-brick mb-2">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true)
                  api.getOnboardingStarter().then(setStarter).catch(() => null).finally(() => setLoading(false))
                }}
                className="text-xs text-ochre underline"
              >
                Retry
              </button>
            </div>
          )}

          {starter && !loading && (
            <>
              <p className="text-[11px] font-mono uppercase tracking-widest text-faint">
                Starter conversation
                {starter.notebook ? ` · ${starter.notebook}` : ` · #${starter.chatlog_id}`}
              </p>
              <div className="space-y-3 rounded-sm border border-edge bg-surface/50 px-4 py-3">
                {starter.preview_turns.map((turn, i) => (
                  <div key={turn.message_index} className={i > 0 ? 'pt-3 border-t border-edge-subtle' : ''}>
                    <p className="font-mono text-[9px] uppercase tracking-wider text-ochre mb-1">
                      Student · message {i + 1}
                    </p>
                    <div className="font-serif text-[15px] leading-snug text-paper mb-2 line-clamp-4">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                        }}
                      >
                        {turn.message_text.length > 280
                          ? `${turn.message_text.slice(0, 280)}…`
                          : turn.message_text}
                      </ReactMarkdown>
                    </div>
                    <p className="text-[10px] text-faint mb-1.5">A professor might call this:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {turn.suggested_label_names.map((labelName) => (
                        <button
                          key={labelName}
                          type="button"
                          onClick={() => setName(labelName)}
                          className="text-[11px] px-2 py-0.5 rounded-sm border border-edge-subtle bg-surface text-muted hover:border-ochre-dim hover:text-on-canvas transition-colors"
                        >
                          {labelName}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-faint leading-relaxed">{suggestionHint}</p>
            </>
          )}

          <div className="rounded-sm border border-ochre/40 bg-ochre/5 px-3 py-3">
            <label
              htmlFor="onboarding-label-name"
              className="block font-mono text-[10px] tracking-[0.12em] uppercase text-ochre mb-1"
            >
              First label
            </label>
            <p className="text-[11px] text-muted mb-2 leading-relaxed">
              Type a short name, then mark messages Yes or No for it.
            </p>
            <input
              id="onboarding-label-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && start()}
              disabled={!starter || busy}
              placeholder="e.g. Concept question"
              className="w-full appearance-none bg-surface border border-edge text-on-canvas px-3 py-2 rounded-sm font-sans text-sm focus:outline-none focus:border-ochre-dim disabled:opacity-50"
            />
          </div>
        </div>

        <div className="px-6 pb-6 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !name.trim() || !starter}
            onClick={start}
            className="flex-1 min-w-[140px] border border-ochre bg-ochre text-bg-warm px-4 py-2 rounded-sm font-sans font-semibold text-sm hover:brightness-110 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Start labeling'}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            className="px-4 py-2 text-xs text-faint hover:text-muted border border-edge rounded-sm"
          >
            Skip tutorial
          </button>
        </div>
      </div>
    </div>
  )
}
