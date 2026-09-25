import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Truck,
  Timer,
  TrendingUp,
  Radio,
  Hospital,
  Zap,
  ChevronRight,
} from 'lucide-react';
import {
  VEHICLE_META,
  type AmbulanceState,
  type SimEvent,
  type IncidentState,
  EDGES,
  getNode,
} from '../data/world';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

// ─── Active Emergencies Panel (left sidebar) ───────────────────────────────

export function EmergencyList({
  ambulances,
  incidents,
  selectedAmbulanceId,
  onSelectAmbulance,
}: {
  ambulances: AmbulanceState[];
  incidents: IncidentState[];
  selectedAmbulanceId: string | null;
  onSelectAmbulance: (id: string) => void;
}) {
  const active = ambulances.filter((a) => a.status !== 'arrived');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
        <div className="w-2 h-2 rounded-full bg-[#FF3B30] animate-pulse" />
        <h2 className="text-xs font-semibold text-white/80 uppercase tracking-wider">Active Emergencies</h2>
        <span className="ml-auto text-xs text-white/40 tabular-nums">{active.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 scroll-area">
        {active.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Activity className="w-8 h-8 text-white/15 mb-2" />
            <p className="text-xs text-white/30">No active emergencies</p>
            <p className="text-xs text-white/20 mt-1">Spawn an EV to begin</p>
          </div>
        )}

        <AnimatePresence>
          {active.map((amb) => {
            const severityColor =
              amb.severity === 'CRITICAL' ? '#FF3B30' : amb.severity === 'URGENT' ? '#FFCC00' : '#34C759';
            const isSelected = amb.id === selectedAmbulanceId;
            const dest = getNode(amb.destinationNodeId);
            const eta = amb.remainingEtaSec;
            const vMeta = VEHICLE_META[amb.vehicleType];

            return (
              <motion.div
                key={amb.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20, scale: 0.95 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                onClick={() => onSelectAmbulance(amb.id)}
                className={`group cursor-pointer rounded-xl p-3 border transition-all ${
                  isSelected
                    ? 'bg-white/10 border-white/20'
                    : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/10'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${vMeta.color}20` }}
                  >
                    <Truck className="w-4 h-4" style={{ color: vMeta.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-white">{amb.id}</span>
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                        style={{ color: vMeta.color, backgroundColor: `${vMeta.color}15` }}
                      >
                        {vMeta.shortLabel}
                      </span>
                    </div>
                    <p className="text-xs text-white/40 truncate">→ {dest?.name ?? '—'}</p>
                  </div>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                    style={{ color: severityColor, backgroundColor: `${severityColor}15` }}
                  >
                    {amb.severity}
                  </span>
                </div>

                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-white/30">
                    {amb.status === 'enroute' ? 'En route' : amb.status === 'idle' ? 'Dispatching...' : 'Arrived'}
                  </span>
                  {eta !== undefined && amb.status === 'enroute' && (
                    <span className="text-[10px] text-white/50 tabular-nums flex items-center gap-1">
                      <Timer className="w-3 h-3" />
                      {Math.ceil(eta / 60)}m ETA
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {incidents.length > 0 && (
          <div className="pt-2 mt-2 border-t border-white/5">
            <p className="text-[10px] text-white/30 uppercase tracking-wider px-2 mb-2">Incidents</p>
            {incidents.map((inc) => (
              <motion.div
                key={inc.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#FF3B30]/5 border border-[#FF3B30]/10"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-[#FF3B30] flex-shrink-0" />
                <span className="text-xs text-white/60">{inc.id}</span>
                <span className="text-[10px] text-white/30 ml-auto">{inc.type}</span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Alert Feed (right sidebar) ────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { color: string; icon: typeof Zap; label: string }> = {
  'signal:preempted': { color: '#34C759', icon: Zap, label: 'Signal Preempted' },
  'signal:scheduled': { color: '#FFCC00', icon: Timer, label: 'Signal Scheduled' },
  'signal:unscheduled': { color: '#8E8E93', icon: ChevronRight, label: 'Signal Reverted' },
  'route:updated': { color: '#007AFF', icon: TrendingUp, label: 'Route Updated' },
  'route:invalidated': { color: '#FF9500', icon: AlertTriangle, label: 'Route Invalidated' },
  'incident:new': { color: '#FF3B30', icon: AlertTriangle, label: 'New Incident' },
  'incident:cleared': { color: '#34C759', icon: ChevronRight, label: 'Incident Cleared' },
  'signal:conflict': { color: '#BF5AF2', icon: Zap, label: 'Signal Conflict' },
  'ambulance:arrived': { color: '#8E8E93', icon: Hospital, label: 'Arrived' },
  'ambulance:spawned': { color: '#007AFF', icon: Truck, label: 'Dispatched' },
};

export function AlertFeed({ events }: { events: SimEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!hovered && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events, hovered]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
        <Radio className="w-3.5 h-3.5 text-[#007AFF]" />
        <h2 className="text-xs font-semibold text-white/80 uppercase tracking-wider">Alert Feed</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#34C759] animate-pulse" />
          <span className="text-[10px] text-white/40">LIVE</span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 scroll-area"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Radio className="w-8 h-8 text-white/15 mb-2" />
            <p className="text-xs text-white/30">No events yet</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {events.slice(0, 50).map((evt) => {
            const config = EVENT_CONFIG[evt.type] ?? { color: '#8E8E93', icon: ChevronRight, label: evt.type };
            const Icon = config.icon;
            const time = new Date(evt.timestamp).toLocaleTimeString('en-US', { hour12: false });

            return (
              <motion.div
                key={evt.id}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: `${config.color}15` }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: config.color }}>
                      {config.label}
                    </span>
                    <span className="text-[10px] text-white/30 tabular-nums ml-auto">{time}</span>
                  </div>
                  <p className="text-[10px] text-white/40 mt-0.5 truncate">
                    {formatEventPayload(evt)}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function formatEventPayload(evt: SimEvent): string {
  const p = evt.payload;
  const vType = p.vehicleType ? String(p.vehicleType) : null;
  const vLabel = vType && vType in VEHICLE_META ? VEHICLE_META[vType as keyof typeof VEHICLE_META].shortLabel : null;

  switch (evt.type) {
    case 'signal:scheduled':
      return `Green light scheduled at ${p.nodeId} for ${p.ambId}`;
    case 'signal:preempted':
      return `${p.nodeId} turned green for ${p.ambId}`;
    case 'signal:unscheduled':
      return `${p.nodeId} returned to auto — ${p.reason}`;
    case 'route:updated':
      return `${p.ambId} rerouted (${p.reason})`;
    case 'route:invalidated':
      return `${p.ambId} route blocked at ${p.blockedEdgeId}`;
    case 'incident:new':
      return `New ${(p.type as string)?.toLowerCase() ?? 'incident'} reported on ${p.edgeId ?? 'road'}`;
    case 'incident:cleared':
      return `Incident ${p.id} cleared`;
    case 'signal:conflict':
      return `${p.winnerAmbId} takes priority over ${p.loserAmbId} at ${p.nodeId}`;
    case 'ambulance:arrived':
      return `${p.ambId} arrived at ${p.nodeId}`;
    case 'ambulance:spawned':
      return vLabel
        ? `${p.ambId} dispatched (${vLabel}, ${p.severity})`
        : `${p.ambId} dispatched (${p.severity})`;
    default:
      return JSON.stringify(p).slice(0, 60);
  }
}

// ─── Analytics Cards ──────────────────────────────────────────────────────

export function AnalyticsCards({
  ambulances,
  stats,
  events,
}: {
  ambulances: AmbulanceState[];
  stats: { signalsPreempted: number; reroutes: number };
  events: SimEvent[];
}) {
  const activeCount = ambulances.filter((a) => a.status === 'enroute').length;
  const arrived = ambulances.filter((a) => a.status === 'arrived');
  const avgResponse = arrived.length > 0
    ? arrived.reduce((sum, a) => sum + ((a.arrivalTime ?? 0) - a.spawnTime), 0) / arrived.length
    : 0;

  const sparkData = Array.from({ length: 20 }, (_, i) => ({
    i,
    v: events.filter((e) => e.timestamp > Date.now() - (20 - i) * 3000).length,
  }));

  const cards = [
    { label: 'Active EVs', value: String(activeCount), icon: Truck, color: '#007AFF' },
    { label: 'Avg Response', value: avgResponse > 0 ? `${Math.ceil(avgResponse / 60)}m` : '—', icon: Timer, color: '#34C759' },
    { label: 'Signals Preempted', value: String(stats.signalsPreempted), icon: Zap, color: '#FFCC00' },
    { label: 'Reroutes', value: String(stats.reroutes), icon: TrendingUp, color: '#FF3B30' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="grid grid-cols-2 gap-2 w-[280px]"
    >
      {cards.map((card, i) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.4 + i * 0.05 }}
            className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-xl p-3"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${card.color}15` }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: card.color }} />
              </div>
              <span className="text-[10px] text-white/40 uppercase tracking-wide truncate">{card.label}</span>
            </div>
            <div className="text-2xl font-bold text-white tabular-nums">{card.value}</div>
          </motion.div>
        );
      })}
      <div className="col-span-2 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-xl p-3 h-[60px]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-white/40 uppercase tracking-wide">Event Activity</span>
          <span className="text-[10px] text-white/30">{events.length} total</span>
        </div>
        <ResponsiveContainer width="100%" height={32}>
          <LineChart data={sparkData}>
            <Line
              type="monotone"
              dataKey="v"
              stroke="#007AFF"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}

// ─── Vehicle Detail Card ──────────────────────────────────────────────────

export function VehicleDetail({
  ambulance,
  onClose,
}: {
  ambulance: AmbulanceState | null;
  onClose: () => void;
}) {
  if (!ambulance) return null;

  const dest = getNode(ambulance.destinationNodeId);
  const origin = getNode(ambulance.originNodeId);
  const severityColor =
    ambulance.severity === 'CRITICAL' ? '#FF3B30' : ambulance.severity === 'URGENT' ? '#FFCC00' : '#34C759';
  const vMeta = VEHICLE_META[ambulance.vehicleType];

  const routeNodes = ambulance.routeEdgeIds.length > 0 ? getRouteNodeNames(ambulance) : [];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl p-4 w-[300px]"
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${vMeta.color}20` }}
          >
            <Truck className="w-5 h-5" style={{ color: vMeta.color }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">{ambulance.id}</span>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase"
                style={{ color: vMeta.color, backgroundColor: `${vMeta.color}15` }}
              >
                {vMeta.shortLabel}
              </span>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase"
                style={{ color: severityColor, backgroundColor: `${severityColor}15` }}
              >
                {ambulance.severity}
              </span>
            </div>
            <span className="text-xs text-white/40">{ambulance.status}</span>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
            <ChevronRight className="w-4 h-4 rotate-90" />
          </button>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">Vehicle</span>
            <span className="text-white/70">{vMeta.label}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">From</span>
            <span className="text-white/70">{origin?.name ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">To</span>
            <span className="text-white/70">{dest?.name ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">ETA</span>
            <span className="text-white/70 tabular-nums">
              {Math.ceil((ambulance.remainingEtaSec ?? 0) / 60)} min
            </span>
          </div>
        </div>

        {routeNodes.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <p className="text-[10px] text-white/30 uppercase tracking-wide mb-2">Green Corridor</p>
            <div className="flex items-center gap-1 flex-wrap">
              {routeNodes.map((name, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className={`text-[10px] ${i === 0 || i === routeNodes.length - 1 ? 'text-white/60 font-medium' : 'text-white/30'}`}>
                    {name}
                  </span>
                  {i < routeNodes.length - 1 && (
                    <div className="w-3 h-[1px] bg-[#34C759]/40" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function getRouteNodeNames(amb: AmbulanceState): string[] {
  const names: string[] = [];
  const originNode = getNode(amb.originNodeId);
  if (originNode) names.push(originNode.name);
  let current = amb.originNodeId;
  for (const edgeId of amb.routeEdgeIds) {
    const edge = EDGES.find((e) => e.id === edgeId);
    if (!edge) continue;
    const next = edge.from === current ? edge.to : edge.from;
    const node = getNode(next);
    if (node) names.push(node.name);
    current = next;
  }
  return names;
}