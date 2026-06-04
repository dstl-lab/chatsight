import { useState, useEffect } from 'react'
import { api } from '../services/api'
import type { LabelNameSuggestion } from '../types'

export function useLabelSuggestions() {
  const [suggestions, setSuggestions] = useState<LabelNameSuggestion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getNameSuggestions()
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false))
  }, [])

  return { suggestions, loading }
}
