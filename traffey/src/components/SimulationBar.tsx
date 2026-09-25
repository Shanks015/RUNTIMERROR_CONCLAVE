import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  Truck,
  AlertTriangle,
  Trash2,
  RotateCcw,
  MapPin,
  X,
  Zap,
  MoreHorizontal,
  Shield,
  Flame,
  LifeBuoy,
  Ambulance,
} from 'lucide-react';
import {
  NODES,
  VEHICLE_META,
  VEHICLE_TYPES,
  type Severity,
  type VehicleType,
} from '../data/world';
import type { SpawnAmbulanceParams } from '../hooks/useSimulation';

const VEHICLE_ICON: Record<VehicleType, typeof Truck> = {
  AMBULANCE: Ambulance,
  POLICE: Shield,
  FIRE: Flame,
  RESCUE: LifeBuoy,
};

interface SimulationBarProps {
  running: boolean;
  speed: number;
  onTogglePlay: () => void;
  onSetSpeed: (s: number) => void;
  onSpawnAmbulance: (params: SpawnAmbulanceParams) => void;
  onSpawnIncident: (lat: number, lng: number, edgeId: string | null) => void;
  onClearIncidents: () => void;
  onReset: () => void;
  onSetClickMode: (mode: 'none' | 'incident') => void;
  clickMode: 'none' | 'incident';
}

export default function SimulationBar(props: SimulationBarProps) {
  const [showSpawnDialog, setShowSpawnDialog] = useState(false);
  const [showScenarioDialog, setShowScenarioDialog] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  useEffect(() => {
    const handler = () => setShowSpawnDialog(true);
    window.addEventListener('open-spawn-dialog', handler);
    return () => window.removeEventListener('open-spawn-dialog', handler);
  }, []);

  return (
    <>
      <div className="flex items-center gap-1.5 px-2 py-2 backdrop-blur-xl bg-white/[0.04] border border-white/10 rounded-2xl shadow-2xl">
        <button
          onClick={props.onTogglePlay}
          className="w-9 h-9 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center transition-all"
          title={props.running ? 'Pause' : 'Play'}
        >
          {props.running ? (
            <Pause className="w-3.5 h-3.5 text-white" fill="currentColor" />
          ) : (
            <Play className="w-3.5 h-3.5 text-white" fill="currentColor" />
          )}
        </button>

        <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-xl p-0.5">
          {[1, 2, 5].map((s) => (
            <button
              key={s}
              onClick={() => props.onSetSpeed(s)}
              className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg transition-all tabular-nums ${
                props.speed === s
                  ? 'bg-white/[0.12] text-white'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/[0.06] mx-1" />

        <button
          onClick={() => setShowSpawnDialog(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#007AFF] hover:bg-[#0066DD] transition-all shadow-lg shadow-[#007AFF]/20"
        >
          <Truck className="w-3.5 h-3.5 text-white" />
          <span className="text-xs font-semibold text-white">Spawn EV</span>
        </button>

        <button
          onClick={() => props.onSetClickMode(props.clickMode === 'incident' ? 'none' : 'incident')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all ${
            props.clickMode === 'incident'
              ? 'bg-[#FF3B30] border-[#FF3B30] text-white'
              : 'bg-[#FF3B30]/10 hover:bg-[#FF3B30]/20 border-[#FF3B30]/20'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-[#FF3B30]" />
          <span className="text-xs font-medium text-white">
            {props.clickMode === 'incident' ? 'Click map...' : 'Incident'}
          </span>
        </button>

        <button
          onClick={() => setShowScenarioDialog(true)}
          className="w-9 h-9 rounded-xl bg-[#BF5AF2]/10 hover:bg-[#BF5AF2]/20 border border-[#BF5AF2]/15 flex items-center justify-center transition-all"
          title="Scenarios"
        >
          <Zap className="w-3.5 h-3.5 text-[#BF5AF2]" />
        </button>

        <div className="w-px h-5 bg-white/[0.06] mx-1" />

        <div className="relative">
          <button
            onClick={() => setShowMoreMenu((v) => !v)}
            className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] flex items-center justify-center transition-all"
            title="More"
          >
            <MoreHorizontal className="w-4 h-4 text-white/60" />
          </button>

          <AnimatePresence>
            {showMoreMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMoreMenu(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full mb-2 right-0 z-50 w-44 backdrop-blur-xl bg-[#0B1220]/95 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                >
                  <button
                    onClick={() => {
                      props.onClearIncidents();
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-white/50" />
                    <span className="text-xs text-white/80">Clear Incidents</span>
                  </button>
                  <button
                    onClick={() => {
                      props.onReset();
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors text-left border-t border-white/5"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-white/50" />
                    <span className="text-xs text-white/80">Reset Simulation</span>
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {createPortal(
        <AnimatePresence>
          {showSpawnDialog && (
            <SpawnVehicleDialog
              onClose={() => setShowSpawnDialog(false)}
              onSpawn={(params) => {
                props.onSpawnAmbulance(params);
                setShowSpawnDialog(false);
              }}
            />
          )}
        </AnimatePresence>,
        document.body
      )}

      {createPortal(
        <AnimatePresence>
          {showScenarioDialog && (
            <ScenarioDialog
              onClose={() => setShowScenarioDialog(false)}
              onRun={(vehicles) => {
                props.onReset();
                setTimeout(() => {
                  vehicles.forEach((a, i) => {
                    setTimeout(() => props.onSpawnAmbulance(a), i * 500);
                  });
                }, 300);
                setShowScenarioDialog(false);
              }}
              onSpawnIncident={(lat, lng, edgeId) => {
                props.onSpawnIncident(lat, lng, edgeId);
                setShowScenarioDialog(false);
              }}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

// ─── Spawn Vehicle Dialog ─────────────────────────────────────────────────

function SpawnVehicleDialog({
  onClose,
  onSpawn,
}: {
  onClose: () => void;
  onSpawn: (params: SpawnAmbulanceParams) => void;
}) {
  const [vehicleType, setVehicleType] = useState<VehicleType>('AMBULANCE');
  const [severity, setSeverity] = useState<Severity>('CRITICAL');
  const [origin, setOrigin] = useState('NODE-01');
  const [destination, setDestination] = useState('NODE-08');

  const meta = VEHICLE_META[vehicleType];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="backdrop-blur-xl bg-[#1C1C1E]/95 border border-white/10 rounded-3xl shadow-2xl p-6 w-[460px] max-w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${meta.color}20` }}
            >
              {(() => {
                const Icon = VEHICLE_ICON[vehicleType];
                return <Icon className="w-4 h-4" style={{ color: meta.color }} />;
              })()}
            </div>
            <h2 className="text-base font-semibold text-white">Dispatch Emergency Vehicle</h2>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Vehicle type picker */}
        <div className="mb-4">
          <label className="text-xs font-medium text-white/50 mb-2 block">Vehicle Type</label>
          <div className="grid grid-cols-4 gap-2">
            {VEHICLE_TYPES.map((vt) => {
              const m = VEHICLE_META[vt];
              const Icon = VEHICLE_ICON[vt];
              const selected = vehicleType === vt;
              return (
                <button
                  key={vt}
                  onClick={() => setVehicleType(vt)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                    selected
                      ? 'text-white'
                      : 'text-white/40 border-white/5 bg-white/5 hover:bg-white/10'
                  }`}
                  style={
                    selected
                      ? { backgroundColor: `${m.color}20`, borderColor: `${m.color}50` }
                      : {}
                  }
                >
                  <Icon
                    className="w-4 h-4"
                    style={{ color: selected ? m.color : undefined }}
                  />
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: selected ? m.color : undefined }}
                  >
                    {m.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Severity */}
        <div className="mb-4">
          <label className="text-xs font-medium text-white/50 mb-2 block">Priority</label>
          <div className="grid grid-cols-3 gap-2">
            {(['CRITICAL', 'URGENT', 'ROUTINE'] as Severity[]).map((s) => {
              const color = s === 'CRITICAL' ? '#FF3B30' : s === 'URGENT' ? '#FFCC00' : '#34C759';
              return (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={`py-2.5 text-xs font-semibold rounded-xl border transition-all ${
                    severity === s
                      ? 'text-white'
                      : 'text-white/40 border-white/5 bg-white/5 hover:bg-white/10'
                  }`}
                  style={severity === s ? { backgroundColor: `${color}20`, borderColor: `${color}40`, color } : {}}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs font-medium text-white/50 mb-2 block">Origin</label>
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-[#007AFF]/50 transition-all"
          >
            {NODES.map((n) => (
              <option key={n.id} value={n.id} className="bg-[#1C1C1E]">
                {n.id} — {n.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-6">
          <label className="text-xs font-medium text-white/50 mb-2 block">Destination</label>
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-[#007AFF]/50 transition-all"
          >
            {NODES.map((n) => (
              <option key={n.id} value={n.id} className="bg-[#1C1C1E]">
                {n.id} — {n.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() =>
            onSpawn({
              severity,
              vehicleType,
              originNodeId: origin,
              destinationNodeId: destination,
            })
          }
          disabled={origin === destination}
          className="w-full py-3 text-white font-medium text-sm rounded-xl hover:opacity-90 transition-opacity disabled:opacity-30"
          style={{
            background: `linear-gradient(to right, ${meta.color}, ${meta.color}CC)`,
          }}
        >
          {origin === destination ? 'Select different nodes' : `Dispatch ${meta.label}`}
        </button>
      </motion.div>
    </motion.div>
  );
}

// ─── Scenario Dialog ───────────────────────────────────────────────────────

function ScenarioDialog({
  onClose,
  onRun,
  onSpawnIncident,
}: {
  onClose: () => void;
  onRun: (vehicles: SpawnAmbulanceParams[]) => void;
  onSpawnIncident: (lat: number, lng: number, edgeId: string | null) => void;
}) {
  const scenarios = [
    {
      title: 'Cardiac Emergency',
      desc: 'CRITICAL ambulance from Silk Board to Trinity Circle',
      color: '#FF3B30',
      action: () =>
        onRun([
          {
            id: 'AMB-01',
            severity: 'CRITICAL',
            vehicleType: 'AMBULANCE',
            originNodeId: 'NODE-01',
            destinationNodeId: 'NODE-08',
          },
        ]),
    },
    {
      title: 'Multi-Casualty Collision',
      desc: 'Ambulance + Police van with guaranteed conflict at Sony World',
      color: '#FFCC00',
      action: () =>
        onRun([
          {
            id: 'AMB-01',
            severity: 'CRITICAL',
            vehicleType: 'AMBULANCE',
            originNodeId: 'NODE-01',
            destinationNodeId: 'NODE-10',
          },
          {
            id: 'POL-02',
            severity: 'URGENT',
            vehicleType: 'POLICE',
            originNodeId: 'NODE-09',
            destinationNodeId: 'NODE-04',
          },
        ]),
    },
    {
      title: 'Major Fire Emergency',
      desc: 'Fire truck + Ambulance + Police convoy across the city',
      color: '#FF9500',
      action: () =>
        onRun([
          {
            id: 'FIRE-01',
            severity: 'CRITICAL',
            vehicleType: 'FIRE',
            originNodeId: 'NODE-06',
            destinationNodeId: 'NODE-01',
          },
          {
            id: 'AMB-02',
            severity: 'URGENT',
            vehicleType: 'AMBULANCE',
            originNodeId: 'NODE-04',
            destinationNodeId: 'NODE-01',
          },
          {
            id: 'POL-03',
            severity: 'ROUTINE',
            vehicleType: 'POLICE',
            originNodeId: 'NODE-08',
            destinationNodeId: 'NODE-01',
          },
        ]),
    },
    {
      title: 'ORR Blockage',
      desc: 'Ambulance enroute, then incident on ORR triggers reroute',
      color: '#007AFF',
      action: () => {
        onRun([
          {
            id: 'AMB-01',
            severity: 'CRITICAL',
            vehicleType: 'AMBULANCE',
            originNodeId: 'NODE-05',
            destinationNodeId: 'NODE-04',
          },
        ]);
        setTimeout(() => {
          onSpawnIncident(12.9397, 77.6885, 'EDGE-05-06');
        }, 8000);
      },
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="backdrop-blur-xl bg-[#1C1C1E]/95 border border-white/10 rounded-3xl shadow-2xl p-6 w-[500px] max-w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#BF5AF2]/15 flex items-center justify-center">
              <Zap className="w-4 h-4 text-[#BF5AF2]" />
            </div>
            <h2 className="text-base font-semibold text-white">Emergency Scenarios</h2>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2.5">
          {scenarios.map((s) => (
            <motion.button
              key={s.title}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={s.action}
              className="w-full text-left p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all group"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${s.color}15` }}
                >
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-white mb-0.5">{s.title}</h3>
                  <p className="text-xs text-white/40">{s.desc}</p>
                </div>
                <MapPin className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors" />
              </div>
            </motion.button>
          ))}
        </div>

        <p className="text-xs text-white/30 text-center mt-5">
          Running a scenario will reset and spawn the configured emergency vehicles.
        </p>
      </motion.div>
    </motion.div>
  );
}