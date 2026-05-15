import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { NoteEditor } from '../../components/summaries/NoteEditor'

test('shows "+ add note" chip when no note', () => {
  render(<NoteEditor note={null} onSave={vi.fn()} />)
  expect(screen.getByText(/\+ add note/i)).toBeInTheDocument()
})

test('shows the note text when present and saves on blur', () => {
  const onSave = vi.fn()
  render(<NoteEditor note="initial text" onSave={onSave} />)
  const textarea = screen.getByDisplayValue('initial text') as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value: 'new text' } })
  fireEvent.blur(textarea)
  expect(onSave).toHaveBeenCalledWith('new text')
})

test('clicking "+ add note" expands an empty textarea', () => {
  render(<NoteEditor note={null} onSave={vi.fn()} />)
  fireEvent.click(screen.getByText(/\+ add note/i))
  expect(screen.getByRole('textbox')).toBeInTheDocument()
})
