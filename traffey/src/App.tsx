import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, LogOut, MapPin, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from './lib/supabase';
import { useSimulation } from './hooks/useSimulation';
import { useAISummary } from './hooks/useAISummary';
import MapView from './components/MapView';
import { EmergencyList, AlertFeed, AnalyticsCards, VehicleDetail } from './components/Panels';
import SimulationBar from './components/SimulationBar';
import LoginScreen from './components/LoginScreen';
import type { Session } from '@supabase/supabase-js';

const FOCUS_SPEED_MULTIPLIER = 6;
const MAX_EFFECTIVE_SPEED = 30;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedAmbulanceId, setSelectedAmbulanceId] = useState<string | null>(null);
  const [clickMode, setClickMode] = useState<'none' | 'incident'>('none');
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [userSpeed, setUserSpeed] = useState(1);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const sim = useSimulation();

  const aiSummary = useAISummary(
    sim.snapshot.nodes,
    sim.snapshot.edges,
    sim.snapshot.ambulances,
    sim.snapshot.incidents,
    sim.snapshot.stats
  );

  // ─── Auth ────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  // ─── Focus-aware speed boost ─────────────────────────────────────────
  useEffect(() => {
    const effective = focusedNodeId
      ? Math.min(userSpeed * FOCUS_SPEED_MULTIPLIER, MAX_EFFECTIVE_SPEED)
      : userSpeed;
    sim.setSpeed(effective);
  }, [focusedNodeId, userSpeed, sim]);

  if (authLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0A0A0B]">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onAuthed={() => {}} />;
  }

  const selectedAmbulance =
    sim.snapshot.ambulances.find((a) => a.id === selectedAmbulanceId) ?? null;

  const activeEmergencyCount = sim.snapshot.ambulances.filter((a) => a.status !== 'arrived').length;
  const activeIncidentCount = sim.snapshot.incidents.length;
  const activeEventCount = sim.snapshot.events.length;

  return (
    <div className="fixed inset-0 bg-[#0A0A0B] text-white overflow-hidden flex flex-col">
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center px-6 py-3 border-b border-white/5 z-20 bg-[#0A0A0B]/80 backdrop-blur-xl flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#007AFF] to-[#34C759] flex items-center justify-center shadow-lg">
            <Activity className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-tight">
              Smart Traffic Command Center
            </h1>
            <p className="text-[10px] text-white/30">
              Bangalore Urban Traffic & Emergency Response
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                sim.snapshot.running ? 'bg-[#34C759] animate-pulse' : 'bg-white/30'
              }`}
            />
            <span className="text-xs text-white/50 tabular-nums">
              {sim.snapshot.running ? 'LIVE' : 'PAUSED'} · {userSpeed}x
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white/20 to-white/5 flex items-center justify-center border border-white/10">
              <span className="text-xs font-semibold text-white/70">
                {(session.user.email ?? '?')[0].toUpperCase()}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all"
              title="Sign out"
            >
              <LogOut className="w-4 h-4 text-white/50" />
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main layout ────────────────────────────────────────────── */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* LEFT: collapsible emergency list */}
        <div
          className={`flex-shrink-0 relative transition-all duration-300 ${
            leftOpen ? 'w-[280px]' : 'w-0'
          }`}
        >
          <AnimatePresence>
            {leftOpen && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 backdrop-blur-xl bg-white/[0.02] border-r border-white/5 z-10"
              >
                <EmergencyList
                  ambulances={sim.snapshot.ambulances}
                  incidents={sim.snapshot.incidents}
                  selectedAmbulanceId={selectedAmbulanceId}
                  onSelectAmbulance={setSelectedAmbulanceId}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Left rail toggle */}
        <button
          onClick={() => setLeftOpen((v) => !v)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1.5 py-3 px-1.5 backdrop-blur-xl bg-[#0B1220]/90 border border-l-0 border-white/10 rounded-r-xl shadow-2xl hover:bg-[#0B1220] transition-all"
          style={{ left: leftOpen ? '280px' : '0' }}
        >
          {leftOpen ? (
            <ChevronLeft className="w-3.5 h-3.5 text-white/60" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-white/60" />
          )}
          {activeEmergencyCount > 0 && (
            <div className="w-5 h-5 rounded-full bg-[#FF3B30] flex items-center justify-center">
              <span className="text-[9px] font-bold text-white">{activeEmergencyCount}</span>
            </div>
          )}
        </button>

        {/* CENTER: map fills all reclaimed space */}
        <div className="flex-1 relative min-w-0">
          <MapView
            edges={sim.snapshot.edges}
            nodes={sim.snapshot.nodes}
            ambulances={sim.snapshot.ambulances}
            incidents={sim.snapshot.incidents}
            stats={sim.snapshot.stats}
            selectedAmbulanceId={selectedAmbulanceId}
            onSelectAmbulance={setSelectedAmbulanceId}
            onMapClick={
              clickMode === 'incident'
                ? (lat, lng) => {
                    sim.spawnIncident(lat, lng, null);
                    setClickMode('none');
                  }
                : undefined
            }
            clickMode={clickMode}
            focusedNodeId={focusedNodeId}
            onFocusNode={setFocusedNodeId}
            onOverrideSignal={sim.overrideSignal}
            onReleaseNode={sim.releaseNode}
            onSpawnAmb={() => window.dispatchEvent(new CustomEvent('open-spawn-dialog'))}
            aiSummary={aiSummary}
            simActions={{
              overrideSignal: sim.overrideSignal,
              releaseNode: sim.releaseNode,
              spawnIncident: sim.spawnIncident,
              clearAllIncidents: sim.clearAllIncidents,
              setSpeed: sim.setSpeed,
              focusNode: setFocusedNodeId,
            }}
          />

          <div className="absolute top-4 right-4 z-20 pointer-events-auto">
            <AnalyticsCards
              ambulances={sim.snapshot.ambulances}
              stats={sim.snapshot.stats}
              events={sim.snapshot.events}
            />
          </div>

          {selectedAmbulance && (
            <div className="absolute bottom-4 right-4 z-20">
              <VehicleDetail
                ambulance={selectedAmbulance}
                onClose={() => setSelectedAmbulanceId(null)}
              />
            </div>
          )}

          <AnimatePresence>
            {clickMode === 'incident' && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-20 left-1/2 -translate-x-1/2 z-20 px-4 py-2 backdrop-blur-xl bg-[#FF3B30]/15 border border-[#FF3B30]/30 rounded-xl shadow-lg"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#FF3B30] animate-pulse" />
                  <span className="text-xs font-medium text-white">
                    Click on the map to place an incident
                  </span>
                  <button
                    onClick={() => setClickMode('none')}
                    className="text-xs text-white/50 hover:text-white ml-2"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT: collapsible alert feed */}
        <div
          className={`flex-shrink-0 relative transition-all duration-300 ${
            rightOpen ? 'w-[320px]' : 'w-0'
          }`}
        >
          <AnimatePresence>
            {rightOpen && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 backdrop-blur-xl bg-white/[0.02] border-l border-white/5 z-10"
              >
                <AlertFeed events={sim.snapshot.events} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right rail toggle */}
        <button
          onClick={() => setRightOpen((v) => !v)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1.5 py-3 px-1.5 backdrop-blur-xl bg-[#0B1220]/90 border border-r-0 border-white/10 rounded-l-xl shadow-2xl hover:bg-[#0B1220] transition-all"
          style={{ right: rightOpen ? '320px' : '0' }}
        >
          {rightOpen ? (
            <ChevronRight className="w-3.5 h-3.5 text-white/60" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5 text-white/60" />
          )}
          {activeEventCount > 0 && (
            <div className="w-5 h-5 rounded-full bg-[#007AFF] flex items-center justify-center">
              <span className="text-[9px] font-bold text-white">
                {activeEventCount > 99 ? '99' : activeEventCount}
              </span>
            </div>
          )}
        </button>
      </div>

      {/* ─── Bottom: Simulation Bar ──────────────────────────────────── */}
      <div className="flex items-center justify-center px-4 py-3 border-t border-white/5 z-20 bg-[#0A0A0B] flex-shrink-0">
        <SimulationBar
          running={sim.snapshot.running}
          speed={userSpeed}
          onTogglePlay={sim.togglePlay}
          onSetSpeed={setUserSpeed}
          onSpawnAmbulance={sim.spawnAmbulance}
          onSpawnIncident={sim.spawnIncident}
          onClearIncidents={sim.clearAllIncidents}
          onReset={() => {
            sim.reset();
            setSelectedAmbulanceId(null);
            setFocusedNodeId(null);
          }}
          onSetClickMode={setClickMode}
          clickMode={clickMode}
        />
      </div>
    </div>
  );
}