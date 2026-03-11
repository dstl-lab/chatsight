import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import type { LabelItem } from '../types';

interface Props {
  content: string;
  labels: LabelItem[];
  highlightedIndex: number | null;
  onHighlight: (index: number | null) => void;
}

function parseMessages(content: string): { role: string; text: string }[] {
  // Try to parse common chatlog formats
  const lines = content.split('\n');
  const messages: { role: string; text: string }[] = [];
  let current: { role: string; text: string } | null = null;

  for (const line of lines) {
    const humanMatch = line.match(/^(Human|User|Student):\s*(.*)/i);
    const aiMatch = line.match(/^(Assistant|AI|ChatGPT|Claude|GPT):\s*(.*)/i);

    if (humanMatch) {
      if (current) messages.push(current);
      current = { role: 'user', text: humanMatch[2] };
    } else if (aiMatch) {
      if (current) messages.push(current);
      current = { role: 'assistant', text: aiMatch[2] };
    } else if (current && line.trim()) {
      current.text += '\n' + line;
    }
  }
  if (current) messages.push(current);

  // If no format detected, treat whole content as one block
  if (messages.length === 0) {
    return [{ role: 'unknown', text: content }];
  }
  return messages;
}

export default function TranscriptPanel({ content, labels, highlightedIndex, onHighlight }: Props) {
  const messages = parseMessages(content);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (highlightedIndex !== null && refs.current[highlightedIndex]) {
      refs.current[highlightedIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedIndex]);

  const labelsByIndex = new Map<number, LabelItem[]>();
  for (const label of labels) {
    const arr = labelsByIndex.get(label.message_index) ?? [];
    arr.push(label);
    labelsByIndex.set(label.message_index, arr);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h2 className="text-sm font-semibold text-gray-700">Transcript</h2>
        <p className="text-xs text-gray-400 mt-0.5">{messages.length} messages</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => {
          const isHighlighted = highlightedIndex === i;
          const hasLabels = labelsByIndex.has(i);

          return (
            <div
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              className={`rounded-lg p-3 cursor-pointer transition-all border ${
                isHighlighted
                  ? 'border-blue-400 bg-blue-50 shadow-sm'
                  : hasLabels
                  ? 'border-yellow-200 bg-yellow-50 hover:bg-yellow-100'
                  : 'border-gray-100 bg-white hover:bg-gray-50'
              }`}
              onClick={() => onHighlight(isHighlighted ? null : i)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-semibold uppercase tracking-wider ${
                  msg.role === 'user' ? 'text-blue-600' : msg.role === 'assistant' ? 'text-green-600' : 'text-gray-500'
                }`}>
                  {msg.role === 'user' ? 'Student' : msg.role === 'assistant' ? 'AI' : 'Message'} #{i + 1}
                </span>
                {hasLabels && (
                  <span className="text-xs bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded-full">
                    {labelsByIndex.get(i)!.length} label{labelsByIndex.get(i)!.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {msg.role === 'assistant' ? (
                <div className="text-sm text-gray-700 prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-1 prose-code:text-xs prose-pre:text-xs">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{msg.text}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
