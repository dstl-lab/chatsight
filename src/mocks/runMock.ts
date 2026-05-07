import type {
  SingleLabel,
  FocusedMessage,
  ReadinessState,
  ConversationTurn,
} from '../types'

export const mockActiveLabel: SingleLabel = {
  id: 1,
  name: 'Help',
  description: 'Student is asking for assistance, expressing being stuck, or reporting an error.',
  mode: 'single',
  phase: 'labeling',
  is_active: true,
  queue_position: null,
  yes_count: 7,
  no_count: 5,
  skip_count: 0,
  conversations_walked: 4,
  total_conversations: 12,
  hybrid_explore_fraction: null,
  hybrid_explore_effective: 0.35,
}

export const mockQueuedLabels: SingleLabel[] = [
  {
    id: 2,
    name: 'frustration',
    description: null,
    mode: 'single',
    phase: 'queued',
    is_active: false,
    queue_position: 0,
    yes_count: 0,
    no_count: 0,
    skip_count: 0,
    conversations_walked: 0,
    total_conversations: 12,
    hybrid_explore_fraction: null,
    hybrid_explore_effective: 0.35,
  },
  {
    id: 3,
    name: 'vague request',
    description: null,
    mode: 'single',
    phase: 'queued',
    is_active: false,
    queue_position: 1,
    yes_count: 0,
    no_count: 0,
    skip_count: 0,
    conversations_walked: 0,
    total_conversations: 12,
    hybrid_explore_fraction: null,
    hybrid_explore_effective: 0.35,
  },
]

const fullThread: ConversationTurn[] = [
  {
    message_index: 0,
    role: 'student',
    text: "Hey, I'm working on the histogram question in lab 3 and I'm a little lost. Where should I start?",
  },
  {
    message_index: 1,
    role: 'tutor',
    text: "A good place to begin is reading the relevant section of the lab — there's a worked example that uses `plt.hist` on the `baby` table. Try replicating that on your own dataset first; once the shape feels familiar we can adjust the parameters.",
  },
  {
    message_index: 2,
    role: 'student',
    text: 'Ok I read it. What does `bins=10` mean in `plt.hist`? I tried `bins=20` and the chart looked totally different.',
  },
  {
    message_index: 3,
    role: 'tutor',
    text: 'The `bins` argument controls how many equally-spaced intervals the data range is divided into. More bins means each bar covers a smaller range, which can reveal finer detail but also more noise. Try a handful of values and see how the shape changes.',
  },
  {
    message_index: 4,
    role: 'student',
    text: 'Ok but my histogram has a weird gap in the middle. Is that because of `bins` or my data?',
  },
  {
    message_index: 5,
    role: 'tutor',
    text: 'A gap can come from either source. Try printing the value counts in that range first to rule out the data, then experiment with `bins`.',
  },
  {
    message_index: 6,
    role: 'student',
    text: "When I do `df['col'].value_counts()` I just see numbers, but I can't tell if there are missing values or not.",
  },
  {
    message_index: 7,
    role: 'tutor',
    text: "By default `value_counts` excludes NaN. Pass `dropna=False` to see missing values listed separately, and use `df['col'].isna().sum()` to confirm a count.",
  },
  {
    message_index: 8,
    role: 'student',
    text: 'There are 47 NaNs. I dropped them with `dropna()` but the gap is still there.',
  },
  {
    message_index: 9,
    role: 'tutor',
    text: "Then it's likely a real characteristic of the data. Try a finer bin width like `bins=np.arange(min, max, 2)` to see whether the gap is genuine or an artefact of bin alignment.",
  },
  {
    message_index: 10,
    role: 'student',
    text: "I'm honestly stuck. I tried `bins=20` and `bins=np.arange(0,100,5)` but I keep getting the same gap. Can you just tell me what's wrong with my data?",
  },
  {
    message_index: 11,
    role: 'tutor',
    text: "I won't just tell you the answer — but here's a hint: look at the value range you're plotting. Are there any natural reasons that a chunk of values might be missing from your dataset? Also try `df.describe()` on the column.",
  },
  {
    message_index: 12,
    role: 'student',
    text: 'OH. The data is grouped by year, and we don\'t have records for 2020. That\'s the gap. Thanks!',
  },
]

export const mockFocusedMessage: FocusedMessage = {
  chatlog_id: 2148,
  message_index: 5,  // student-only index — corresponds to the 5th student message in the thread (0-indexed)
  text: "I'm honestly stuck. I tried `bins=20` and `bins=np.arange(0,100,5)` but I keep getting the same gap. Can you just tell me what's wrong with my data?",
  notebook: 'lab3.ipynb',
  conversation_turn_count: fullThread.length,
  thread: fullThread,
  focus_index: 10,  // position of the focused turn in the full thread
}

export const mockReadiness: ReadinessState = {
  tier: 'amber',
  yes_count: 7,
  no_count: 5,
  skip_count: 0,
  conversations_walked: 4,
  total_conversations: 12,
  hint: 'Walk 1 more conversation for a green tier (5/5 covered).',
}
