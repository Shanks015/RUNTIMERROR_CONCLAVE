import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Shield,
  Truck,
  MapPin,
  Crosshair,
} from 'lucide-react';
import {
  getNode,
  NODES,
  type AmbulanceState,
  type NodeState,
} from '../data/world';

// ─── Combined top-left pill: junction context + city status ────────────────

export function TopStatusPill({
  focusedNodeId,
  focusedNodeState,
  ambulances,
  stats,
  onSpawn,
  onFocusNode,
}: {
  focusedNodeId: string | null;
  focusedNodeState: NodeState | null;
  ambulances: AmbulanceState[];
  stats: { signalsPreempted: number; reroutes: number };
  onSpawn: () => void;
  onFocusNode: (id: string | null) => void;
}) {
  const active = ambulances.find((a) => a.status === 'enroute');
  const focusedNode = focusedNodeId ? getNode(focusedNodeId) : null;

  // ── Focused state: show junction info + back button ──
  if (focusedNode && focusedNodeState) {
    const phaseColor =
      focusedNodeState.signalPhase === 'GREEN'
        ? '#34C759'
        : focusedNodeState.signalPhase === 'RED'
        ? '#FF3B30'
        : '#FFCC00';

    const modeLabel =
      focusedNodeState.mode === 'AUTO'
        ? 'Auto'
        : focusedNodeState.mode === 'SCHEDULED'
        ? 'Green wave'
        : focusedNodeState.mode === 'MANUAL'
        ? 'Manual'
        : 'EV priority';

    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute top-4 left-4 z-30 flex items-center gap-3 px-4 py-2.5 backdrop-blur-xl bg-[#0B1220]/95 border border-white/10 rounded-full shadow-2xl pointer-events-auto"
      >
        <button
          onClick={() => onFocusNode(null)}
          className="flex items-center gap-1.5 px-2 py-1 -ml-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-[11px] text-white/70"
        >
          <Crosshair className="w-3 h-3" />
          City
        </button>
        <div className="w-px h-4 bg-white/10" />
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: phaseColor, boxShadow: `0 0 8px ${phaseColor}` }}
        />
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white">{focusedNode.name}</span>
          <span className="text-[10px] text-white/40">{modeLabel}</span>
          {focusedNodeState.mode === 'SCHEDULED' && (
            <span className="text-[9px] font-semibold text-[#FFCC00] bg-[#FFCC00]/12 px-1.5 py-0.5 rounded uppercase tracking-wide">
              EV Schedule
            </span>
          )}
        </div>
        <div className="w-px h-4 bg-white/10" />
        <span className="text-[11px] text-white/50 tabular-nums">
          Queue {focusedNodeState.queueLength}
        </span>
      </motion.div>
    );
  }

  // ── Idle/mission state: single combined pill ──
  if (active) {
    const origin = getNode(active.originNodeId);
    const dest = getNode(active.destinationNodeId);
    const eta = active.remainingEtaSec ?? 0;
    const etaMin = Math.floor(eta / 60);
    const etaSec = Math.floor(eta % 60);

    const severityColor =
      active.severity === 'CRITICAL'
        ? '#FF3B30'
        : active.severity === 'URGENT'
        ? '#FFCC00'
        : '#34C759';

    const progressPct =
      active.routeEdgeIds.length > 0
        ? Math.round(
            ((active.routeEdgeIds.indexOf(active.currentEdgeId) + active.progressOnEdge) /
              active.routeEdgeIds.length) *
              100
          )
        : 0;

    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute top-4 left-4 z-30 pointer-events-none"
      >
        <div
          className="backdrop-blur-xl bg-[#0B1220]/95 border rounded-full shadow-2xl pl-4 pr-3 py-2 flex items-center gap-2.5"
          style={{ borderColor: `${severityColor}40` }}
        >
          <div
            className="w-2 h-2 rounded-full animate-pulse flex-shrink-0"
            style={{ background: severityColor }}
          />
          <span
            className="text-[10px] uppercase tracking-wider font-bold flex-shrink-0"
            style={{ color: severityColor }}
          >
            {active.severity}
          </span>
          <span className="text-xs font-bold text-white flex-shrink-0">{active.id}</span>
          <span className="text-[11px] text-white/50 truncate max-w-[180px]">
            {origin?.name} → {dest?.name}
          </span>
          <div className="w-px h-3.5 bg-white/10 flex-shrink-0" />
          <span className="text-[11px] text-white/80 tabular-nums flex-shrink-0">
            ETA {etaMin}:{etaSec.toString().padStart(2, '0')}
          </span>
          <div className="w-px h-3.5 bg-white/10 flex-shrink-0" />
          <span className="text-[11px] text-[#34C759] tabular-nums flex-shrink-0">
            {stats.signalsPreempted} cleared
          </span>
          <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden flex-shrink-0">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{ width: `${progressPct}%`, background: severityColor }}
            />
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.button
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onClick={onSpawn}
      className="absolute top-4 left-4 z-30 pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 backdrop-blur-xl bg-[#0B1220]/95 border border-white/10 rounded-full shadow-2xl hover:bg-[#0B1220] hover:border-white/20 transition-all group"
    >
      <div className="w-2 h-2 rounded-full bg-[#34C759] animate-pulse" />
      <span className="text-xs font-medium text-white/90">
        City normal · 10 junctions
      </span>
      <div className="w-px h-3.5 bg-white/10" />
      <span className="text-xs font-semibold text-[#007AFF] flex items-center gap-1 group-hover:text-white transition-colors">
        <Truck className="w-3 h-3" />
        Spawn EV
      </span>
    </motion.button>
  );
}

// ─── Map legend (small, corner) ────────────────────────────────────────────

export function MapLegend({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-4 left-4 z-20 pointer-events-none"
        >
          <div className="backdrop-blur-xl bg-[#0B1220]/80 border border-white/10 rounded-xl shadow-2xl px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wider text-white/40 mb-1.5 font-medium">
              Legend
            </p>
            <div className="space-y-1">
              {[
                { color: '#34C759', label: 'Green' },
                { color: '#FFCC00', label: 'Amber' },
                { color: '#FF3B30', label: 'Red' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: item.color, boxShadow: `0 0 5px ${item.color}` }}
                  />
                  <span className="text-[10px] text-white/55">{item.label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-0.5">
                <div className="w-4 h-[2px] rounded-full bg-[#34C759]" />
                <span className="text-[10px] text-white/55">Corridor</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── AI Summary Panel (collapsible, sits above chat cluster) ──────────────

export function AISummaryPanel({
  text,
  loading,
  error,
  updatedAt,
  onRefresh,
}: {
  text: string;
  loading: boolean;
  error: string | null;
  updatedAt: number;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const secondsAgo = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;

  return (
    <AnimatePresence>
      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-[68px] left-1/2 -translate-x-1/2 z-30 w-[560px] max-w-[calc(100vw-2rem)] pointer-events-auto"
        >
          <div className="backdrop-blur-xl bg-[#0B1220]/95 border border-[#BF5AF2]/25 rounded-2xl shadow-2xl px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-md bg-[#BF5AF2]/15 flex items-center justify-center">
                <Brain className="w-3 h-3 text-[#BF5AF2]" />
              </div>
              <p className="text-[10px] font-semibold text-white/70 uppercase tracking-wider">
                Situation Brief
              </p>
              <div className="ml-auto flex items-center gap-1.5">
                {secondsAgo !== null && (
                  <span className="text-[10px] text-white/30 tabular-nums">
                    {secondsAgo < 3 ? 'just now' : `${secondsAgo}s ago`}
                  </span>
                )}
                <button
                  onClick={onRefresh}
                  disabled={loading}
                  className="w-6 h-6 rounded-md hover:bg-white/10 flex items-center justify-center transition-colors disabled:opacity-40"
                  title="Refresh"
                >
                  {loading ? (
                    <Loader2 className="w-3 h-3 text-white/60 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3 text-white/60" />
                  )}
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  className="w-6 h-6 rounded-md hover:bg-white/10 flex items-center justify-center transition-colors"
                  title="Collapse"
                >
                  <ChevronDown className="w-3 h-3 text-white/60" />
                </button>
              </div>
            </div>

            {error ? (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-[#FF3B30] flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-[#FF3B30]/90 leading-relaxed">{error}</p>
              </div>
            ) : text ? (
              <p className="text-[12px] text-white/85 leading-relaxed">{text}</p>
            ) : (
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-white/40 animate-spin" />
                <p className="text-[11px] text-white/40 italic">Analyzing…</p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── AI toggle button (small, sits next to chat button) ────────────────────

export function AISummaryButton({
  onClick,
  loading,
  updatedAt,
}: {
  onClick: () => void;
  loading: boolean;
  updatedAt: number;
}) {
  const secondsAgo = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 backdrop-blur-xl bg-[#0B1220]/90 border border-[#BF5AF2]/25 rounded-full shadow-2xl hover:bg-[#0B1220] hover:border-[#BF5AF2]/50 transition-all"
      title="Situation Brief"
    >
      <div className="w-5 h-5 rounded-md bg-[#BF5AF2]/15 flex items-center justify-center">
        <Brain className="w-3 h-3 text-[#BF5AF2]" />
      </div>
      <span className="text-xs font-medium text-white/80">Brief</span>
      {loading && <Loader2 className="w-3 h-3 text-white/40 animate-spin" />}
      {!loading && secondsAgo !== null && (
        <span className="text-[10px] text-white/40 tabular-nums">
          {secondsAgo < 3 ? 'now' : `${secondsAgo}s`}
        </span>
      )}
      <ChevronUp className="w-3 h-3 text-white/40" />
    </button>
  );
}

// ─── Operator Controls (unchanged) ─────────────────────────────────────────

export function OperatorControls({
  node,
  state,
  onOverride,
  onRelease,
}: {
  node: { id: string; name: string };
  state: NodeState;
  onOverride: (nodeId: string, phase: 'GREEN' | 'RED' | 'AMBER') => void;
  onRelease: (nodeId: string) => void;
}) {
  const isManual = state.mode === 'MANUAL';

  return (
    <div className="mt-4 pt-4 border-t border-white/5">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-3 h-3 text-[#007AFF]" />
        <p className="text-[10px] text-white/50 uppercase tracking-wider">Operator Control</p>
        {isManual && (
          <span className="text-[9px] font-semibold text-[#FFCC00] bg-[#FFCC00]/10 px-2 py-0.5 rounded ml-auto">
            MANUAL
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <button
          onClick={() => onOverride(node.id, 'GREEN')}
          className={`py-2 rounded-lg text-[10px] font-semibold transition-all ${
            state.signalPhase === 'GREEN'
              ? 'bg-[#34C759]/20 text-[#34C759] border border-[#34C759]/40'
              : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
          }`}
        >
          GREEN
        </button>
        <button
          onClick={() => onOverride(node.id, 'AMBER')}
          className={`py-2 rounded-lg text-[10px] font-semibold transition-all ${
            state.signalPhase === 'AMBER'
              ? 'bg-[#FFCC00]/20 text-[#FFCC00] border border-[#FFCC00]/40'
              : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
          }`}
        >
          AMBER
        </button>
        <button
          onClick={() => onOverride(node.id, 'RED')}
          className={`py-2 rounded-lg text-[10px] font-semibold transition-all ${
            state.signalPhase === 'RED'
              ? 'bg-[#FF3B30]/20 text-[#FF3B30] border border-[#FF3B30]/40'
              : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
          }`}
        >
          RED
        </button>
      </div>

      <button
        onClick={() => onRelease(node.id)}
        disabled={!isManual && state.mode === 'AUTO'}
        className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-white/60 font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Release to Auto
      </button>
    </div>
  );
}