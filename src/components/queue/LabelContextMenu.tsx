import { useEffect, useRef } from 'react'

interface Props {
  x: number
  y: number
  labelName: string
  onRename: () => void
  onEditDescription: () => void
  onDelete?: () => void
  onClose: () => void
}

export function LabelContextMenu({ x, y, labelName, onRename, onEditDescription, onDelete, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escHandler)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: x, top: y, zIndex: 50 }}
      className="bg-elevated border border-edge rounded-lg py-1 min-w-[160px] shadow-xl"
    >
      <div className="px-3 py-1 text-[10px] text-faint truncate max-w-[160px]">{labelName}</div>
      <div className="border-t border-edge my-1" />
      <button
        onClick={() => { onRename(); onClose() }}
        className="w-full text-left px-3 py-1.5 text-[12px] text-on-surface hover:bg-elevated-hl transition-colors"
      >
        Rename
      </button>
      <button
        onClick={() => { onEditDescription(); onClose() }}
        className="w-full text-left px-3 py-1.5 text-[12px] text-on-surface hover:bg-elevated-hl transition-colors"
      >
        Edit description
      </button>
      {onDelete && (
        <>
          <div className="border-t border-edge my-1" />
          <button
            onClick={() => { onDelete(); onClose() }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-danger-text hover:bg-elevated-hl transition-colors"
          >
            Delete
          </button>
        </>
      )}
    </div>
  )
}
