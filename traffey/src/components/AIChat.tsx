import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Search,
  Send,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { AmbulanceState, IncidentState, NodeState, EdgeState } from '../data/world';
import { useAIChat, type ChatMessage, type SimActions } from '../hooks/useAIChat';

// ─── Suggestion pool (categorized to match Ask · Monitor · Control) ────────

type SuggestionCategory = 'Ask' | 'Monitor' | 'Control';

interface Suggestion {
  category: SuggestionCategory;
  text: string;
}

const SUGGESTION_POOL: Suggestion[] = [
  // ASK — situational awareness (read-only)
  { category: 'Ask', text: 'What is happening right now?' },
  { category: 'Ask', text: 'Which junctions have the longest queues?' },
  { category: 'Ask', text: 'Which roads are most congested right now?' },
  { category: 'Ask', text: 'Are any emergency vehicles delayed?' },
  { category: 'Ask', text: 'Which incidents are still unresolved?' },
  { category: 'Ask', text: 'Give me a one-line status of the whole network' },
  { category: 'Ask', text: 'Which junction has been in manual mode longest?' },
  { category: 'Ask', text: 'Is traffic rerouting happening right now?' },

  // MONITOR — predictive / explain / compare / summarize
  { category: 'Monitor', text: 'Which junction is likely to get congested next?' },
  { category: 'Monitor', text: 'Why was the last vehicle rerouted?' },
  { category: 'Monitor', text: 'Compare Silk Board vs Marathahalli right now' },
  { category: 'Monitor', text: 'What caused the last reroute?' },
  { category: 'Monitor', text: 'Summarize the last 5 minutes' },
  { category: 'Monitor', text: 'How many preemptions in the last hour?' },

  // CONTROL — direct actions + navigation
  { category: 'Control', text: 'Force Ejipura to green' },
  { category: 'Control', text: 'Release Domlur back to auto' },
  { category: 'Control', text: 'Show me Silk Board' },
  { category: 'Control', text: 'Show me the busiest junction' },
  { category: 'Control', text: 'Zoom out to city view' },
  { category: 'Control', text: 'Clear all incidents' },
  { category: 'Control', text: 'Pause the simulation' },
];

const CATEGORY_COLOR: Record<SuggestionCategory, string> = {
  Ask: '#007AFF',
  Monitor: '#BF5AF2',
  Control: '#34C759',
};

// Query tools return multi-line informational content
const QUERY_TOOLS = new Set([
  'get_recent_incidents',
  'get_unresolved_incidents',
  'get_recent_reroutes',
  'get_recent_events',
  'get_preemption_count',
]);

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickSuggestions(count = 5): Suggestion[] {
  const byCategory: Record<SuggestionCategory, Suggestion[]> = {
    Ask: SUGGESTION_POOL.filter((s) => s.category === 'Ask'),
    Monitor: SUGGESTION_POOL.filter((s) => s.category === 'Monitor'),
    Control: SUGGESTION_POOL.filter((s) => s.category === 'Control'),
  };

  const askCount = Math.max(1, Math.floor(count * 0.4));
  const monitorCount = Math.max(1, Math.floor(count * 0.3));
  const controlCount = Math.max(1, count - askCount - monitorCount);

  return shuffle([
    ...shuffle(byCategory.Ask).slice(0, askCount),
    ...shuffle(byCategory.Monitor).slice(0, monitorCount),
    ...shuffle(byCategory.Control).slice(0, controlCount),
  ]);
}

// ─── Chat trigger button ──────────────────────────────────────────────────

export function AIChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 backdrop-blur-xl bg-[#0B1220]/90 border border-[#BF5AF2]/25 rounded-full shadow-2xl hover:bg-[#0B1220] hover:border-[#BF5AF2]/50 transition-all"
      title="Ask the network"
    >
      <div className="w-5 h-5 rounded-md bg-[#BF5AF2]/15 flex items-center justify-center">
        <MessageSquare className="w-3 h-3 text-[#BF5AF2]" />
      </div>
      <span className="text-xs font-medium text-white/80">Ask AI</span>
    </button>
  );
}

export function AIChatPanel({
  open,
  onClose,
  nodes,
  edges,
  ambulances,
  incidents,
  stats,
  simActions,
}: {
  open: boolean;
  onClose: () => void;
  nodes: Record<string, NodeState>;
  edges: Record<string, EdgeState>;
  ambulances: AmbulanceState[];
  incidents: IncidentState[];
  stats: { signalsPreempted: number; reroutes: number };
  simActions: SimActions;
}) {
  const { messages, loading, error, send, clear } = useAIChat(
    nodes,
    edges,
    ambulances,
    incidents,
    stats,
    simActions
  );
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>(() => pickSuggestions(5));
  const [errorDismissed, setErrorDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, suggestions, error]);

  // Reset error dismissal when new error arrives
  useEffect(() => {
    if (error) setErrorDismissed(false);
  }, [error]);

  // Reshuffle suggestions after each assistant reply
  useEffect(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    if (lastAssistant.id !== lastAssistantIdRef.current) {
      lastAssistantIdRef.current = lastAssistant.id;
      setSuggestions(pickSuggestions(5));
    }
  }, [messages]);

  const userTyping = input.trim().length > 0;
  const hasMessages = messages.length > 0;
  const showSuggestions = !userTyping && !loading && suggestions.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    send(input);
    setInput('');
  };

  const handleSuggestionClick = (text: string) => {
    send(text);
    setInput('');
  };

  const handleClear = () => {
    clear();
    setSuggestions(pickSuggestions(5));
    lastAssistantIdRef.current = null;
    setErrorDismissed(true);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-[68px] right-4 z-40 w-[440px] max-w-[calc(100vw-2rem)] h-[600px] flex flex-col backdrop-blur-xl bg-[#0B1220]/95 border border-[#BF5AF2]/25 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* ─── Header ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5 flex-shrink-0">
            <div className="relative">
              <div className="w-7 h-7 rounded-lg bg-[#BF5AF2]/15 flex items-center justify-center">
                <Brain className="w-3.5 h-3.5 text-[#BF5AF2]" />
              </div>
              {/* Live status dot */}
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0B1220] ${
                  error && !errorDismissed
                    ? 'bg-[#FF3B30]'
                    : loading
                    ? 'bg-[#FFCC00]'
                    : 'bg-[#34C759]'
                }`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white">Ops Co-pilot</p>
              <p className="text-[10px] text-white/40">
                {error && !errorDismissed
                  ? 'Error — see below'
                  : loading
                  ? 'Working…'
                  : 'Ask · Monitor · Control'}
              </p>
            </div>
            <button
              onClick={handleClear}
              disabled={!hasMessages}
              className="w-6 h-6 rounded-md hover:bg-white/10 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Clear conversation"
            >
              <Trash2 className="w-3 h-3 text-white/50" />
            </button>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-md hover:bg-white/10 flex items-center justify-center transition-colors"
            >
              <X className="w-3.5 h-3.5 text-white/50" />
            </button>
          </div>

          {/* ─── Error banner ────────────────────────────────────────── */}
          <AnimatePresence>
            {error && !errorDismissed && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="flex-shrink-0 overflow-hidden"
              >
                <div className="flex items-start gap-2 px-3 py-2.5 mx-3 mt-2 bg-[#FF3B30]/10 border border-[#FF3B30]/30 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#FF3B30] flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-[#FF3B30] flex-1 leading-relaxed">
                    {error}
                  </p>
                  <button
                    onClick={() => setErrorDismissed(true)}
                    className="text-[#FF3B30]/60 hover:text-[#FF3B30] transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ─── Messages ────────────────────────────────────────────── */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scroll-area">
            {!hasMessages && (
              <div className="space-y-2">
                <p className="text-[11px] text-white/40 mb-3">
                  Ask about the network or tell me to act on it:
                </p>
                <SuggestionChips
                  suggestions={suggestions}
                  onClick={handleSuggestionClick}
                  variant="full"
                />
              </div>
            )}

            {messages.map((msg) => (
              <MessageRenderer key={msg.id} msg={msg} />
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/[0.06] border border-white/5 rounded-bl-sm">
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse" />
                    <div
                      className="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse"
                      style={{ animationDelay: '0.15s' }}
                    />
                    <div
                      className="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse"
                      style={{ animationDelay: '0.3s' }}
                    />
                  </div>
                  <span className="text-[11px] text-white/50">Checking the network…</span>
                </div>
              </div>
            )}

            {hasMessages && showSuggestions && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="pt-2"
              >
                <p className="text-[9px] text-white/25 uppercase tracking-wider mb-2">Try next</p>
                <SuggestionChips
                  suggestions={suggestions}
                  onClick={handleSuggestionClick}
                  variant="compact"
                />
              </motion.div>
            )}
          </div>

          {/* ─── Input ───────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="p-3 border-t border-white/5 flex-shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.04] border border-white/10 rounded-xl focus-within:border-[#BF5AF2]/50 transition-colors">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask or command…"
                disabled={loading}
                className="flex-1 bg-transparent text-[12px] text-white placeholder-white/30 focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="w-7 h-7 rounded-lg bg-[#BF5AF2] hover:bg-[#A84AE0] flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="w-3 h-3 text-white" />
              </button>
            </div>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Message renderer ─────────────────────────────────────────────────────

function MessageRenderer({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'tool') {
    const isQuery = msg.toolName ? QUERY_TOOLS.has(msg.toolName) : false;
    if (isQuery) return <QueryResultCard msg={msg} />;
    return <ActionChip msg={msg} />;
  }

  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed ${
          isUser
            ? 'bg-[#007AFF] text-white rounded-br-sm'
            : 'bg-white/[0.06] text-white/85 border border-white/5 rounded-bl-sm'
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
}

// ─── Action confirmation chip (compact, single-line) ──────────────────────

function ActionChip({ msg }: { msg: ChatMessage }) {
  const success = msg.toolSuccess;

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex justify-start"
    >
      <div
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full text-[11px] font-medium ${
          success
            ? 'bg-[#34C759]/12 border border-[#34C759]/30 text-[#34C759]'
            : 'bg-[#FF3B30]/12 border border-[#FF3B30]/30 text-[#FF3B30]'
        }`}
      >
        {success ? (
          <Check className="w-3 h-3 flex-shrink-0" />
        ) : (
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
        )}
        <Zap className="w-3 h-3 flex-shrink-0 opacity-70" />
        <span>{msg.content}</span>
      </div>
    </motion.div>
  );
}

// ─── Query result card (multi-line, expandable, informational) ────────────

function QueryResultCard({ msg }: { msg: ChatMessage }) {
  const lines = msg.content.split('\n').filter((l) => l.trim());
  const isMultiLine = lines.length > 1;
  const [expanded, setExpanded] = useState(isMultiLine ? false : true);

  const preview = lines[0] ?? msg.content;
  const hiddenCount = Math.max(0, lines.length - 1);

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex justify-start w-full"
    >
      <div className="max-w-[90%] min-w-[220px] rounded-xl border border-[#007AFF]/25 bg-[#007AFF]/[0.06] overflow-hidden">
        {/* Header */}
        <button
          onClick={() => isMultiLine && setExpanded((v) => !v)}
          disabled={!isMultiLine}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left ${
            isMultiLine ? 'hover:bg-white/[0.03] transition-colors' : ''
          }`}
        >
          <div className="w-4 h-4 rounded bg-[#007AFF]/20 flex items-center justify-center flex-shrink-0">
            <Search className="w-2.5 h-2.5 text-[#007AFF]" />
          </div>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-[#007AFF] flex-1 truncate">
            {humanizeToolName(msg.toolName)}
          </span>
          {isMultiLine && (
            <>
              <span className="text-[10px] text-white/40 tabular-nums">
                {lines.length} {lines.length === 1 ? 'item' : 'items'}
              </span>
              {expanded ? (
                <ChevronUp className="w-3 h-3 text-white/40 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-white/40 flex-shrink-0" />
              )}
            </>
          )}
        </button>

        {/* Body */}
        <div className="px-3 pb-2.5">
          {expanded ? (
            <div className="space-y-1">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className="text-[11px] text-white/75 leading-relaxed break-words font-mono"
                >
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-white/60 leading-relaxed truncate">
              {preview}
              {hiddenCount > 0 && (
                <span className="text-white/35 ml-1.5">+{hiddenCount} more</span>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function humanizeToolName(name?: string): string {
  if (!name) return 'Result';
  switch (name) {
    case 'get_recent_incidents':
      return 'Recent incidents';
    case 'get_unresolved_incidents':
      return 'Unresolved incidents';
    case 'get_recent_reroutes':
      return 'Recent reroutes';
    case 'get_recent_events':
      return 'Recent events';
    case 'get_preemption_count':
      return 'Preemption count';
    default:
      return name.replace(/_/g, ' ');
  }
}

// ─── Suggestion chips ─────────────────────────────────────────────────────

function SuggestionChips({
  suggestions,
  onClick,
  variant,
}: {
  suggestions: Suggestion[];
  onClick: (text: string) => void;
  variant: 'full' | 'compact';
}) {
  if (variant === 'full') {
    return (
      <div className="space-y-1.5">
        {suggestions.map((s, i) => (
          <button
            key={`${s.category}-${i}`}
            onClick={() => onClick(s.text)}
            className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] transition-all text-[11px] text-white/70"
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: CATEGORY_COLOR[s.category] }}
            />
            <span className="flex-1 truncate">{s.text}</span>
            <span className="text-[9px] text-white/25 uppercase tracking-wider">
              {s.category}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {suggestions.map((s, i) => (
        <button
          key={`${s.category}-${i}`}
          onClick={() => onClick(s.text)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] transition-all text-white/70 max-w-full"
        >
          <span
            className="w-1 h-1 rounded-full flex-shrink-0"
            style={{ background: CATEGORY_COLOR[s.category] }}
          />
          <span className="truncate">{s.text}</span>
        </button>
      ))}
    </div>
  );
}