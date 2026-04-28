import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

interface Props {
  text: string
  contextBefore: string | null
}

export function FocusedMessage({ text, contextBefore }: Props) {
  return (
    <div className="rounded-lg border-2 border-indigo-500/50 bg-neutral-900 p-5 space-y-3 shadow-lg">
      {contextBefore && (
        <div className="text-sm text-neutral-400 border-b border-neutral-800 pb-3">
          <span className="text-neutral-500 text-xs">preceding tutor turn:</span>
          <div className="mt-1">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {contextBefore}
            </ReactMarkdown>
          </div>
        </div>
      )}
      <div>
        <span className="text-neutral-500 text-xs uppercase tracking-wide">student message under decision</span>
        <div className="mt-2 text-neutral-100 prose prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
