import { useEffect, useRef, useState, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import {
  APIProvider,
  Map as GoogleMap,
  useMap,
  type MapMouseEvent,
} from '@vis.gl/react-google-maps';
import { motion } from 'framer-motion';
import { ChevronLeft, Crosshair, MapPin, Minimize2, Maximize2 } from 'lucide-react';
import {
  DARK_MAP_STYLE,
  MAP_CENTER,
  MAP_ZOOM,
  VEHICLE_META,
  type VehicleType,
  NODES,
  EDGES,
  getNode,
  getEdge,
  getOtherEnd,
  bearing,
  type EdgeState,
  type NodeState,
  type AmbulanceState,
  type IncidentState,
  type Node,
} from '../data/world';
import { useSnappedEdges, closestIndexOnPath, type SnappedPath } from '../hooks/useSnappedEdges';
import { useBackgroundTraffic, type BgCar } from '../hooks/useBackgroundTraffic';
import {
  TopStatusPill,
  MapLegend,
  AISummaryPanel,
  AISummaryButton,
  OperatorControls,
} from './HUD';
import { AIChatButton, AIChatPanel } from './AIChat';
import type { AISummaryState } from '../hooks/useAISummary';
import type { SimActions } from '../hooks/useAIChat';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// ─── Helpers ──────────────────────────────────────────────────────────────

function congestionColor(congestion: number): string {
  if (congestion < 0.5) return '#34C759';
  if (congestion < 0.8) return '#FFCC00';
  return '#FF3B30';
}

function zoomScale(zoom: number): number {
  const raw = 1 + (zoom - 12) * 0.35;
  return Math.max(0.6, Math.min(2.2, raw));
}

function getRouteNodes(amb: AmbulanceState): string[] {
  const nodes: string[] = [];
  if (amb.routeEdgeIds.length === 0) return nodes;
  let prev = amb.originNodeId;
  nodes.push(prev);
  for (const edgeId of amb.routeEdgeIds) {
    const e = getEdge(edgeId);
    if (!e) continue;
    const next = getOtherEnd(e, prev);
    nodes.push(next);
    prev = next;
  }
  return nodes;
}

function interpolateAlongPath(
  path: { lat: number; lng: number }[],
  t: number
): { lat: number; lng: number } {
  if (path.length < 2) return path[0] || { lat: 0, lng: 0 };
  const clamped = Math.max(0, Math.min(1, t));
  const segments = path.length - 1;
  const segProgress = clamped * segments;
  const segIdx = Math.min(Math.floor(segProgress), segments - 1);
  const localT = segProgress - segIdx;
  const a = path[segIdx];
  const b = path[segIdx + 1];
  return {
    lat: a.lat + (b.lat - a.lat) * localT,
    lng: a.lng + (b.lng - a.lng) * localT,
  };
}

function computeAmbulanceTarget(
  amb: AmbulanceState,
  snappedPaths: Record<string, SnappedPath>
): { lat: number; lng: number } {
  const edge = getEdge(amb.currentEdgeId);
  if (!edge) return { lat: amb.lat, lng: amb.lng };

  const snapped = snappedPaths[amb.currentEdgeId];
  if (!snapped || snapped.length < 2) {
    return { lat: amb.lat, lng: amb.lng };
  }

  const routeNodes = getRouteNodes(amb);
  const idx = routeNodes.indexOf(edge.from);
  const goingForward = idx >= 0 && routeNodes[idx + 1] === edge.to;
  const oriented = goingForward ? snapped : [...snapped].reverse();

  return interpolateAlongPath(oriented, amb.progressOnEdge);
}

// ─── MapView props ────────────────────────────────────────────────────────

interface MapViewProps {
  edges: Record<string, EdgeState>;
  nodes: Record<string, NodeState>;
  ambulances: AmbulanceState[];
  incidents: IncidentState[];
  stats: { signalsPreempted: number; reroutes: number };
  selectedAmbulanceId: string | null;
  onSelectAmbulance: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  clickMode: 'none' | 'incident';
  focusedNodeId: string | null;
  onFocusNode: (id: string | null) => void;
  onOverrideSignal: (nodeId: string, phase: 'GREEN' | 'RED' | 'AMBER') => void;
  onReleaseNode: (nodeId: string) => void;
  onSpawnAmb: () => void;
  aiSummary: AISummaryState & { refresh: () => void };
  simActions: SimActions;
}

export default function MapView(props: MapViewProps) {
  const [chatOpen, setChatOpen] = useState(false);

  if (!MAPS_API_KEY) {
    return <ApiKeyFallback />;
  }

  const focusedNodeState = props.focusedNodeId ? props.nodes[props.focusedNodeId] : null;

  return (
    <APIProvider apiKey={MAPS_API_KEY} libraries={['geometry', 'routes']}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <MapContent {...props} />

        <JunctionPanel
          focusedNodeId={props.focusedNodeId}
          nodes={props.nodes}
          ambulances={props.ambulances}
          onFocusNode={props.onFocusNode}
          onOverride={props.onOverrideSignal}
          onRelease={props.onReleaseNode}
        />

        <TopStatusPill
          focusedNodeId={props.focusedNodeId}
          focusedNodeState={focusedNodeState}
          ambulances={props.ambulances}
          stats={props.stats}
          onSpawn={props.onSpawnAmb}
          onFocusNode={props.onFocusNode}
        />

        <MapLegend visible={props.focusedNodeId === null} />

        <AISummaryPanel
          text={props.aiSummary.text}
          loading={props.aiSummary.loading}
          error={props.aiSummary.error}
          updatedAt={props.aiSummary.updatedAt}
          onRefresh={props.aiSummary.refresh}
        />
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 pointer-events-auto">
          <AISummaryButton
            onClick={() => {
              const ev = new CustomEvent('ai-summary-toggle');
              window.dispatchEvent(ev);
            }}
            loading={props.aiSummary.loading}
            updatedAt={props.aiSummary.updatedAt}
          />
          <AIChatButton onClick={() => setChatOpen(true)} />
        </div>

        <AIChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          nodes={props.nodes}
          edges={props.edges}
          ambulances={props.ambulances}
          incidents={props.incidents}
          stats={props.stats}
          simActions={props.simActions}
        />
      </div>
    </APIProvider>
  );
}

// ─── API Key Fallback ─────────────────────────────────────────────────────

function ApiKeyFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-[#0A0A0B] relative overflow-hidden">
      <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full bg-[#007AFF]/10 blur-[120px]" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 max-w-lg mx-4 backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl shadow-2xl p-8"
      >
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FFCC00] to-[#FF9500] flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white">
            <path d="M12 2L1 21h22L12 2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.2" />
            <path d="M12 9v5M12 17.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Google Maps API Key Required</h2>
        <p className="text-sm text-white/50 leading-relaxed">
          Add <code className="text-[#34C759]">VITE_GOOGLE_MAPS_API_KEY</code> to your <code className="text-[#34C759]">.env</code> file and enable Maps JavaScript API, Directions API, and Geometry Library.
        </p>
      </motion.div>
    </div>
  );
}

// ─── Camera controller ────────────────────────────────────────────────────

function CameraController({ focusedNodeId }: { focusedNodeId: string | null }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    if (focusedNodeId) {
      const node = getNode(focusedNodeId);
      if (node) {
        map.panTo({ lat: node.lat, lng: node.lng });
        map.setZoom(17);
      }
    } else {
      map.panTo(MAP_CENTER);
      map.setZoom(MAP_ZOOM);
    }
  }, [focusedNodeId, map]);

  return null;
}

// ─── Zoom tracker ─────────────────────────────────────────────────────────

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    onZoom(map.getZoom() ?? MAP_ZOOM);
    const listener = map.addListener('zoom_changed', () => {
      onZoom(map.getZoom() ?? MAP_ZOOM);
    });
    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, onZoom]);
  return null;
}

// ─── Junction panel ───────────────────────────────────────────────────────

function JunctionPanel({
  focusedNodeId,
  nodes,
  ambulances,
  onFocusNode,
  onOverride,
  onRelease,
}: {
  focusedNodeId: string | null;
  nodes: Record<string, NodeState>;
  ambulances: AmbulanceState[];
  onFocusNode: (id: string | null) => void;
  onOverride: (nodeId: string, phase: 'GREEN' | 'RED' | 'AMBER') => void;
  onRelease: (nodeId: string) => void;
}) {
  const [minimized, setMinimized] = useState(true);

  useEffect(() => {
    if (focusedNodeId) setMinimized(false);
  }, [focusedNodeId]);

  const focusedNode = focusedNodeId ? getNode(focusedNodeId) : null;
  const focusedState = focusedNodeId ? nodes[focusedNodeId] : null;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-2 backdrop-blur-xl bg-[#0B1220]/90 border border-white/10 rounded-full shadow-2xl hover:bg-[#0B1220] transition-colors"
      >
        <MapPin className="w-3.5 h-3.5 text-[#007AFF]" />
        <span className="text-xs font-medium text-white">
          {focusedNode ? focusedNode.name : 'Junctions'}
        </span>
        <Maximize2 className="w-3 h-3 text-white/40" />
      </button>
    );
  }

  return (
    <div className="absolute top-4 left-4 z-20 w-[300px] max-h-[calc(100%-2rem)] overflow-hidden flex flex-col">
      <div className="backdrop-blur-xl bg-[#0B1220]/90 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-[#007AFF]" />
            <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
              {focusedNode ? 'Junction Detail' : 'Junctions'}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {focusedNodeId && (
              <button
                onClick={() => onFocusNode(null)}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-[10px] text-white/70"
              >
                <ChevronLeft className="w-3 h-3" />
                Back
              </button>
            )}
            <button
              onClick={() => setMinimized(true)}
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
              title="Minimize"
            >
              <Minimize2 className="w-3 h-3 text-white/50" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto scroll-area" style={{ maxHeight: 'calc(100vh - 14rem)' }}>
          {focusedNode && focusedState ? (
            <FocusDetail
              node={focusedNode}
              state={focusedState}
              ambulances={ambulances}
              onOverride={onOverride}
              onRelease={onRelease}
            />
          ) : (
            <JunctionList nodes={nodes} onSelect={(id) => onFocusNode(id)} />
          )}
        </div>
      </div>
    </div>
  );
}

function JunctionList({
  nodes,
  onSelect,
}: {
  nodes: Record<string, NodeState>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="p-2">
      <p className="text-[10px] text-white/40 px-2 py-2 leading-relaxed">
        Click any junction to zoom in and see live signal state.
      </p>
      {NODES.map((node) => {
        const state = nodes[node.id];
        if (!state) return null;
        const phaseColor =
          state.signalPhase === 'GREEN'
            ? '#34C759'
            : state.signalPhase === 'RED'
            ? '#FF3B30'
            : '#FFCC00';

        return (
          <button
            key={node.id}
            onClick={() => onSelect(node.id)}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group"
          >
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{
                background: phaseColor,
                boxShadow: `0 0 8px ${phaseColor}`,
              }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">
                {node.name}
              </div>
              <div className="text-[10px] text-white/40 mt-0.5">{node.id}</div>
            </div>
            <Crosshair className="w-3 h-3 text-white/20 group-hover:text-white/60 transition-colors flex-shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

function FocusDetail({
  node,
  state,
  ambulances,
  onOverride,
  onRelease,
}: {
  node: Node;
  state: NodeState;
  ambulances: AmbulanceState[];
  onOverride: (nodeId: string, phase: 'GREEN' | 'RED' | 'AMBER') => void;
  onRelease: (nodeId: string) => void;
}) {
  const phaseColor =
    state.signalPhase === 'GREEN'
      ? '#34C759'
      : state.signalPhase === 'RED'
      ? '#FF3B30'
      : '#FFCC00';

  const phaseLabel =
    state.signalPhase === 'GREEN'
      ? 'Traffic is flowing'
      : state.signalPhase === 'RED'
      ? 'Cross traffic stopped'
      : 'Switching…';

  const modeLabel =
    state.mode === 'AUTO'
      ? 'Auto cycling'
      : state.mode === 'SCHEDULED'
      ? 'Green wave scheduled'
      : state.mode === 'EV_PRIORITY'
      ? 'Emergency priority'
      : 'Manual control';

  const approaching = ambulances.filter(
    (a) =>
      a.status === 'enroute' &&
      a.routeEdgeIds.length > 0 &&
      getRouteNodes(a).includes(node.id)
  );

  return (
    <div className="p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white leading-tight">{node.name}</h3>
        <p className="text-[10px] text-white/40 mt-0.5">{node.id}</p>
      </div>

      <div className="space-y-2 mb-4">
        <InfoRow
          label="Signal"
          value={
            <span className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: phaseColor, boxShadow: `0 0 6px ${phaseColor}` }}
              />
              <span className="text-white">{state.signalPhase}</span>
            </span>
          }
          hint={phaseLabel}
        />
        <InfoRow label="Mode" value={state.mode} hint={modeLabel} />
        <InfoRow
          label="Queue"
          value={`${state.queueLength} vehicles`}
          hint={
            state.queueLength > 10
              ? 'Heavy backup'
              : state.queueLength > 4
              ? 'Moderate'
              : 'Light'
          }
        />
      </div>

      <div className="pt-3 border-t border-white/5">
        <p className="text-[10px] text-white/40 uppercase tracking-wider mb-2">
          Incoming EVs
        </p>
        {approaching.length === 0 ? (
          <p className="text-[11px] text-white/30">None approaching</p>
        ) : (
          <div className="space-y-1.5">
            {approaching.map((amb) => {
              const sevColor =
                amb.severity === 'CRITICAL'
                  ? '#FF3B30'
                  : amb.severity === 'URGENT'
                  ? '#FFCC00'
                  : '#34C759';
              const vMeta = VEHICLE_META[amb.vehicleType];
              return (
                <div
                  key={amb.id}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/5"
                  style={{ borderLeft: `3px solid ${vMeta.color}` }}
                >
                  <span className="text-xs font-semibold text-white">{amb.id}</span>
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ color: vMeta.color, backgroundColor: `${vMeta.color}15` }}
                  >
                    {vMeta.shortLabel}
                  </span>
                  <span className="text-[10px] ml-auto" style={{ color: sevColor }}>
                    {amb.severity}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <OperatorControls
        node={{ id: node.id, name: node.name }}
        state={state}
        onOverride={onOverride}
        onRelease={onRelease}
      />
    </div>
  );
}

function InfoRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="flex-1">
        <div className="text-[10px] text-white/40 uppercase tracking-wider">{label}</div>
        {hint && <div className="text-[10px] text-white/30 mt-0.5">{hint}</div>}
      </div>
      <div className="text-xs font-medium text-white text-right">{value}</div>
    </div>
  );
}

// ─── Map content ──────────────────────────────────────────────────────────

function MapContent(props: MapViewProps) {
  const { paths: snappedPaths } = useSnappedEdges();
  const bgCars = useBackgroundTraffic(props.edges, props.nodes);
  const [zoom, setZoom] = useState<number>(MAP_ZOOM);

  const handleZoom = useCallback((z: number) => setZoom(z), []);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (props.clickMode === 'incident' && props.onMapClick) {
        const latLng = e.detail.latLng;
        if (latLng) props.onMapClick(latLng.lat, latLng.lng);
      }
    },
    [props.clickMode, props.onMapClick]
  );

  return (
    <GoogleMap
      defaultCenter={MAP_CENTER}
      defaultZoom={MAP_ZOOM}
      style={{ width: '100%', height: '100%' }}
      styles={DARK_MAP_STYLE}
      gestureHandling="greedy"
      keyboardShortcuts
      clickableIcons={false}
      draggable
      zoomControl
      scrollwheel
      mapTypeControl={false}
      streetViewControl={false}
      fullscreenControl={false}
      backgroundColor="#0A0A0B"
      onClick={handleMapClick}
      minZoom={9}
      maxZoom={20}
    >
      <ZoomTracker onZoom={handleZoom} />
      <CameraController focusedNodeId={props.focusedNodeId} />
      <EdgeLayers
        edges={props.edges}
        snappedPaths={snappedPaths}
        ambulances={props.ambulances}
        zoom={zoom}
      />
      <CorridorLayer
        ambulances={props.ambulances}
        selectedAmbulanceId={props.selectedAmbulanceId}
        snappedPaths={snappedPaths}
        zoom={zoom}
      />
      <BackgroundTrafficLayer cars={bgCars} snappedPaths={snappedPaths} zoom={zoom} />
      <NodeOverlays
        nodes={props.nodes}
        focusedNodeId={props.focusedNodeId}
        onFocusNode={props.onFocusNode}
      />
      <IncidentOverlays incidents={props.incidents} edges={props.edges} zoom={zoom} />
      <EndpointOverlays ambulances={props.ambulances} zoom={zoom} />
      <AmbulanceOverlays
        ambulances={props.ambulances}
        selectedAmbulanceId={props.selectedAmbulanceId}
        onSelectAmbulance={props.onSelectAmbulance}
        snappedPaths={snappedPaths}
        zoom={zoom}
      />
    </GoogleMap>
  );
}

// ─── Edge layers ──────────────────────────────────────────────────────────

function EdgeLayers({
  edges,
  snappedPaths,
  ambulances,
  zoom,
}: {
  edges: Record<string, EdgeState>;
  snappedPaths: Record<string, SnappedPath>;
  ambulances: AmbulanceState[];
  zoom: number;
}) {
  const map = useMap();
  const polylinesRef = useRef<globalThis.Map<string, google.maps.Polyline>>(new globalThis.Map());

  useEffect(() => {
    if (!map) return;

    const scale = zoomScale(zoom);
    const activeRoutes = ambulances
      .filter((a) => a.status === 'enroute')
      .flatMap((a) => a.routeEdgeIds);
    const hasActiveEV = activeRoutes.length > 0;

    for (const edge of EDGES) {
      const state = edges[edge.id];
      if (!state) continue;

      let path: { lat: number; lng: number }[] = snappedPaths[edge.id];
      if (!path || path.length < 2) {
        const fromNode = getNode(edge.from)!;
        const toNode = getNode(edge.to)!;
        path = [
          { lat: fromNode.lat, lng: fromNode.lng },
          { lat: toNode.lat, lng: toNode.lng },
        ];
      }

      const isOnRoute = activeRoutes.includes(edge.id);
      let polyline = polylinesRef.current.get(edge.id);
      const color = state.incidentBlocked ? '#7F1D1D' : congestionColor(state.liveCongestion);

      const congestionWeight = 3 + state.liveCongestion * 4;
      const onRouteBoost = isOnRoute ? 1.4 : 1.0;
      const strokeWeight = congestionWeight * onRouteBoost * scale;

      const strokeOpacity = state.incidentBlocked
        ? 0.5
        : hasActiveEV
        ? isOnRoute
          ? 0.95
          : 0.25
        : 0.6;

      const icons = state.incidentBlocked
        ? [{
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 3 * Math.min(scale, 2),
              fillColor: '#FF3B30',
              fillOpacity: 0.8,
              strokeColor: '#FF3B30',
              strokeWeight: 1,
            },
            offset: '0',
            repeat: '12px',
          }]
        : [];

      if (!polyline) {
        polyline = new google.maps.Polyline({
          path,
          map,
          strokeColor: color,
          strokeWeight,
          strokeOpacity,
          icons: icons as google.maps.IconSequence[],
          zIndex: 1,
        });
        polylinesRef.current.set(edge.id, polyline);
      } else {
        polyline.setPath(path);
        polyline.setOptions({
          strokeColor: color,
          strokeWeight,
          strokeOpacity,
          icons: icons as google.maps.IconSequence[],
        });
      }
    }
  }, [map, edges, snappedPaths, ambulances, zoom]);

  useEffect(() => {
    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current.clear();
    };
  }, []);

  return null;
}

// ─── Corridor layer ───────────────────────────────────────────────────────

function CorridorLayer({
  ambulances,
  selectedAmbulanceId,
  snappedPaths,
  zoom,
}: {
  ambulances: AmbulanceState[];
  selectedAmbulanceId: string | null;
  snappedPaths: Record<string, SnappedPath>;
  zoom: number;
}) {
  const map = useMap();
  const polylinesRef = useRef<{
    glow: google.maps.Polyline | null;
    core: google.maps.Polyline | null;
  }>({ glow: null, core: null });

  const amb =
    ambulances.find(
      (a) => a.id === selectedAmbulanceId && a.status === 'enroute' && a.routeEdgeIds.length > 0
    ) ||
    ambulances.find((a) => a.status === 'enroute' && a.routeEdgeIds.length > 0) ||
    null;

  useEffect(() => {
    if (!map) return;

    let path: { lat: number; lng: number }[] = [];
    if (amb) {
      path = buildCorridorPath(amb, snappedPaths);
    }

    const scale = zoomScale(zoom);

    if (path.length >= 2) {
      if (!polylinesRef.current.glow) {
        polylinesRef.current.glow = new google.maps.Polyline({
          map,
          strokeColor: '#34C759',
          strokeWeight: 12,
          strokeOpacity: 0.18,
          zIndex: 2,
        });
      }
      polylinesRef.current.glow.setPath(path);
      polylinesRef.current.glow.setOptions({ strokeWeight: 12 * scale });

      if (!polylinesRef.current.core) {
        polylinesRef.current.core = new google.maps.Polyline({
          map,
          strokeColor: '#34C759',
          strokeWeight: 4,
          strokeOpacity: 1.0,
          zIndex: 3,
        });
      }
      polylinesRef.current.core.setPath(path);
      polylinesRef.current.core.setOptions({ strokeWeight: 4 * scale });
    } else {
      if (polylinesRef.current.glow) {
        polylinesRef.current.glow.setMap(null);
        polylinesRef.current.glow = null;
      }
      if (polylinesRef.current.core) {
        polylinesRef.current.core.setMap(null);
        polylinesRef.current.core = null;
      }
    }
  }, [
    map,
    amb?.id,
    amb?.routeEdgeIds.join(','),
    amb?.progressOnEdge,
    amb?.currentEdgeId,
    snappedPaths,
    zoom,
  ]);

  useEffect(() => {
    return () => {
      polylinesRef.current.glow?.setMap(null);
      polylinesRef.current.core?.setMap(null);
    };
  }, []);

  return null;
}

function buildCorridorPath(
  amb: AmbulanceState,
  snappedPaths: Record<string, SnappedPath>
): { lat: number; lng: number }[] {
  const path: { lat: number; lng: number }[] = [];

  const currentEdge = getEdge(amb.currentEdgeId);
  if (!currentEdge) return path;

  const routeNodes = getRouteNodes(amb);
  const fromNodeIdx = routeNodes.indexOf(currentEdge.from);
  const goingForward = fromNodeIdx >= 0 && routeNodes[fromNodeIdx + 1] === currentEdge.to;

  const startPos = computeAmbulanceTarget(amb, snappedPaths);
  path.push(startPos);

  const currentSnapped = snappedPaths[currentEdge.id];
  if (currentSnapped && currentSnapped.length >= 2) {
    const oriented = goingForward ? currentSnapped : [...currentSnapped].reverse();
    const startIdx = closestIndexOnPath(oriented, startPos);
    for (let i = startIdx + 1; i < oriented.length; i++) {
      path.push(oriented[i]);
    }
  }

  let prevNode = getOtherEnd(currentEdge, goingForward ? currentEdge.from : currentEdge.to);

  const currentIdx = amb.routeEdgeIds.indexOf(amb.currentEdgeId);
  for (let i = currentIdx + 1; i < amb.routeEdgeIds.length; i++) {
    const edge = getEdge(amb.routeEdgeIds[i]);
    if (!edge) continue;

    const snapped = snappedPaths[edge.id];
    if (snapped && snapped.length >= 2) {
      const reversed = prevNode === edge.to;
      const oriented = reversed ? [...snapped].reverse() : snapped;
      for (const p of oriented) path.push(p);
    } else {
      const nextNode = getOtherEnd(edge, prevNode);
      const n = getNode(nextNode);
      if (n) path.push({ lat: n.lat, lng: n.lng });
    }

    prevNode = getOtherEnd(edge, prevNode);
  }

  return path;
}

// ─── Background traffic layer ─────────────────────────────────────────────

function BackgroundTrafficLayer({
  cars,
  snappedPaths,
  zoom,
}: {
  cars: BgCar[];
  snappedPaths: Record<string, SnappedPath>;
  zoom: number;
}) {
  const map = useMap();
  const markersRef = useRef<globalThis.Map<string, google.maps.Marker>>(new globalThis.Map());

  const visible = zoom >= 13;
  const baseScale = Math.max(2, Math.min(5, 2 + (zoom - 13) * 0.55));

  useEffect(() => {
    if (!map) return;

    if (!visible) {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
      return;
    }

    const seen = new Set<string>();

    for (const car of cars) {
      seen.add(car.id);

      const snapped = snappedPaths[car.edgeId];
      if (!snapped || snapped.length < 2) continue;

      const t = car.progress;
      const totalSegs = snapped.length - 1;
      const scaled = t * totalSegs;
      const idx = Math.min(Math.floor(scaled), totalSegs - 1);
      const localT = scaled - idx;
      const a = snapped[idx];
      const b = snapped[idx + 1];
      const lat = a.lat + (b.lat - a.lat) * localT;
      const lng = a.lng + (b.lng - a.lng) * localT;

      const colors = ['#9CA3AF', '#78716C', '#A1A1AA'];
      const color = colors[car.variant];

      const dotScale = baseScale * 0.85;
      const dotOpacity = 0.6 + car.speed * 0.3;

      let marker = markersRef.current.get(car.id);
      if (!marker) {
        marker = new google.maps.Marker({
          position: { lat, lng },
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: dotScale,
            fillColor: color,
            fillOpacity: dotOpacity,
            strokeColor: '#0A0A0B',
            strokeWeight: 0.5,
          },
          zIndex: 2,
          clickable: false,
        });
        markersRef.current.set(car.id, marker);
      } else {
        marker.setPosition({ lat, lng });
        marker.setIcon({
          path: google.maps.SymbolPath.CIRCLE,
          scale: dotScale,
          fillColor: color,
          fillOpacity: dotOpacity,
          strokeColor: '#0A0A0B',
          strokeWeight: 0.5,
        });
      }
    }

    markersRef.current.forEach((marker, id) => {
      if (!seen.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    });
  }, [map, cars, snappedPaths, visible, baseScale]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
    };
  }, []);

  return null;
}

// ─── DOM overlay helper ───────────────────────────────────────────────────

interface OverlayViewProps {
  position: { lat: number; lng: number };
  children: React.ReactNode;
  zIndex?: number;
}

function DomOverlay({ position, children, zIndex = 100 }: OverlayViewProps) {
  const map = useMap();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<google.maps.OverlayView | null>(null);

  useEffect(() => {
    if (!map) return;

    class OverlayView extends google.maps.OverlayView {
      position: { lat: number; lng: number };
      container: HTMLDivElement | null = null;

      constructor(pos: { lat: number; lng: number }) {
        super();
        this.position = pos;
      }

      override onAdd() {
        this.container = document.createElement('div');
        this.container.style.position = 'absolute';
        this.container.style.transform = 'translate(-50%, -50%)';
        this.container.style.zIndex = String(zIndex);
        const panes = this.getPanes();
        // Use floatPane for max z-index — sits above ALL polylines and markers
        if (panes) {
          (panes.floatPane ?? panes.overlayLayer).appendChild(this.container);
        }
        containerRef.current = this.container;
      }

      override draw() {
        if (!this.container) return;
        const projection = this.getProjection();
        if (!projection) return;
        const point = projection.fromLatLngToDivPixel(
          new google.maps.LatLng(this.position.lat, this.position.lng)
        );
        if (point) {
          this.container.style.left = `${point.x}px`;
          this.container.style.top = `${point.y}px`;
        }
      }

      override onRemove() {
        if (this.container && this.container.parentNode) {
          this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
      }

      updatePosition(pos: { lat: number; lng: number }) {
        this.position = pos;
        this.draw();
      }
    }

    const overlay = new OverlayView(position);
    overlay.setMap(map);
    overlayRef.current = overlay;

    return () => {
      overlay.setMap(null);
      overlayRef.current = null;
    };
  }, [map, zIndex]);

  useEffect(() => {
    if (overlayRef.current) {
      (overlayRef.current as unknown as {
        updatePosition: (p: { lat: number; lng: number }) => void;
      }).updatePosition(position);
    }
  }, [position.lat, position.lng]);

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const checkContainer = () => {
      if (containerRef.current) {
        setPortalTarget(containerRef.current);
      } else {
        requestAnimationFrame(checkContainer);
      }
    };
    checkContainer();
  }, []);

  if (!portalTarget) return null;

  return createPortal(children, portalTarget);
}

// ─── Node overlays ────────────────────────────────────────────────────────

function NodeOverlays({
  nodes,
  focusedNodeId,
  onFocusNode,
}: {
  nodes: Record<string, NodeState>;
  focusedNodeId: string | null;
  onFocusNode: (id: string | null) => void;
}) {
  return (
    <>
      {NODES.map((node) => {
        const state = nodes[node.id];
        if (!state) return null;
        return (
          <NodeOverlay
            key={node.id}
            node={node}
            state={state}
            focused={focusedNodeId === node.id}
            onFocus={() => onFocusNode(node.id)}
          />
        );
      })}
    </>
  );
}

function NodeOverlay({
  node,
  state,
  focused,
  onFocus,
}: {
  node: Node;
  state: NodeState;
  focused: boolean;
  onFocus: () => void;
}) {
  const color =
    state.signalPhase === 'GREEN'
      ? '#34C759'
      : state.signalPhase === 'RED'
      ? '#FF3B30'
      : '#FFCC00';

  return (
    <DomOverlay position={{ lat: node.lat, lng: node.lng }} zIndex={100}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${color}55 0%, transparent 70%)`,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        />

        {state.mode === 'SCHEDULED' && (
          <>
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                border: '3px solid #FFCC00',
                transform: 'translate(-50%, -50%)',
                animation: 'node-pulse 1.2s ease-out infinite',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                border: '3px solid #FFCC00',
                transform: 'translate(-50%, -50%)',
                animation: 'node-pulse 1.2s ease-out infinite 0.4s',
              }}
            />
          </>
        )}

        {state.mode === 'MANUAL' && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              border: '2px solid #007AFF',
              transform: 'translate(-50%, -50%)',
              animation: 'amb-select 2s ease-in-out infinite',
            }}
          />
        )}

        {focused && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: '2px solid #007AFF',
              transform: 'translate(-50%, -50%)',
              animation: 'amb-select 2s ease-in-out infinite',
            }}
          />
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: color,
            boxShadow: `0 0 24px ${color}, 0 0 10px ${color}, 0 0 0 3px rgba(255,255,255,0.25), 0 0 0 6px rgba(0,0,0,0.4)`,
            transition: 'background-color 0.3s ease, box-shadow 0.3s ease, transform 0.15s ease',
            position: 'relative',
            zIndex: 2,
            cursor: 'pointer',
            border: '2px solid rgba(255,255,255,0.9)',
            padding: 0,
            pointerEvents: 'auto',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        />

        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          style={{
            fontSize: '11px',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 500,
            color: 'rgba(255,255,255,0.9)',
            backgroundColor: 'rgba(0,0,0,0.75)',
            padding: '3px 8px',
            borderRadius: '6px',
            marginTop: '8px',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            letterSpacing: '0.01em',
            border: '1px solid rgba(255,255,255,0.1)',
            pointerEvents: 'auto',
            backdropFilter: 'blur(8px)',
          }}
        >
          {node.name}
        </button>
      </div>
    </DomOverlay>
  );
}

// ─── Incident overlays ────────────────────────────────────────────────────

function IncidentOverlays({
  incidents,
  zoom,
}: {
  incidents: IncidentState[];
  edges: Record<string, EdgeState>;
  zoom: number;
}) {
  return (
    <>
      {incidents.map((inc) => (
        <IncidentOverlay key={inc.id} incident={inc} zoom={zoom} />
      ))}
    </>
  );
}

function IncidentOverlay({ incident, zoom }: { incident: IncidentState; zoom: number }) {
  const size = Math.max(24, Math.min(44, 24 + (zoom - 12) * 3));
  return (
    <DomOverlay position={{ lat: incident.lat, lng: incident.lng }} zIndex={90}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '70px',
            height: '70px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,59,48,0.3) 0%, transparent 70%)',
            transform: 'translate(-50%, -50%)',
            animation: 'incident-glow 2s ease-in-out infinite',
          }}
        />
        <svg
          viewBox="0 0 24 24"
          width={size}
          height={size}
          style={{ filter: 'drop-shadow(0 0 8px rgba(255,59,48,0.9))' }}
        >
          <path d="M12 2L1 21h22L12 2z" fill="#FF3B30" fillOpacity="0.4" stroke="#FF3B30" strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 9v5M12 17.5v.5" stroke="#FF3B30" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </DomOverlay>
  );
}

// ─── Endpoint overlays ────────────────────────────────────────────────────

function EndpointOverlays({
  ambulances,
  zoom,
}: {
  ambulances: AmbulanceState[];
  zoom: number;
}) {
  const active = ambulances.filter((a) => a.status === 'enroute' || a.status === 'idle');
  const size = Math.max(20, Math.min(36, 20 + (zoom - 12) * 2.5));

  return (
    <>
      {active.map((amb) => {
        const origin = getNode(amb.originNodeId);
        const dest = getNode(amb.destinationNodeId);
        if (!origin || !dest) return null;
        return (
          <Fragment key={amb.id}>
            <EndpointMarker
              key={`${amb.id}-origin`}
              position={{ lat: origin.lat, lng: origin.lng }}
              type="origin"
              label={`${amb.id} start`}
              size={size}
            />
            <EndpointMarker
              key={`${amb.id}-dest`}
              position={{ lat: dest.lat, lng: dest.lng }}
              type="destination"
              label={`${amb.id} dest`}
              size={size}
            />
          </Fragment>
        );
      })}
    </>
  );
}

function EndpointMarker({
  position,
  type,
  label,
  size,
}: {
  position: { lat: number; lng: number };
  type: 'origin' | 'destination';
  label: string;
  size: number;
}) {
  const isOrigin = type === 'origin';
  const color = isOrigin ? '#34C759' : '#FF3B30';
  const icon = isOrigin ? 'A' : 'B';

  return (
    <DomOverlay position={position} zIndex={95}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: '50%',
            background: `linear-gradient(180deg, ${color} 0%, ${color}CC 100%)`,
            border: '3px solid white',
            boxShadow: `0 4px 12px rgba(0,0,0,0.6), 0 0 16px ${color}80, inset 0 -3px 6px rgba(0,0,0,0.25)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 800,
            fontSize: `${Math.round(size * 0.5)}px`,
            color: 'white',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
          }}
        >
          {icon}
        </div>

        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: `${size * 0.2}px solid transparent`,
            borderRight: `${size * 0.2}px solid transparent`,
            borderTop: `${size * 0.28}px solid ${color}`,
            marginTop: '-2px',
            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.5))',
          }}
        />

        <div
          style={{
            fontSize: '10px',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            color: 'white',
            backgroundColor: 'rgba(0,0,0,0.9)',
            padding: '2px 7px',
            borderRadius: '4px',
            marginTop: '2px',
            whiteSpace: 'nowrap',
            border: `1px solid ${color}`,
            letterSpacing: '0.02em',
          }}
        >
          {label}
        </div>
      </div>
    </DomOverlay>
  );
}

// ─── Ambulance overlays ───────────────────────────────────────────────────

function AmbulanceOverlays({
  ambulances,
  selectedAmbulanceId,
  onSelectAmbulance,
  snappedPaths,
  zoom,
}: {
  ambulances: AmbulanceState[];
  selectedAmbulanceId: string | null;
  onSelectAmbulance: (id: string) => void;
  snappedPaths: Record<string, SnappedPath>;
  zoom: number;
}) {
  const spriteSize = Math.max(40, Math.min(96, 40 + (zoom - 12) * 8));
  return (
    <>
      {ambulances
        .filter((a) => a.status !== 'arrived')
        .map((amb) => {
          const target = computeAmbulanceTarget(amb, snappedPaths);
          return (
            <AmbulanceOverlay
              key={amb.id}
              ambulance={amb}
              targetPosition={target}
              isSelected={amb.id === selectedAmbulanceId}
              onSelect={onSelectAmbulance}
              spriteSize={spriteSize}
            />
          );
        })}
    </>
  );
}

function AmbulanceOverlay({
  ambulance,
  targetPosition,
  isSelected,
  onSelect,
  spriteSize,
}: {
  ambulance: AmbulanceState;
  targetPosition: { lat: number; lng: number };
  isSelected: boolean;
  onSelect: (id: string) => void;
  spriteSize: number;
}) {
  const map = useMap();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<{ draw: () => void; setMap: (m: google.maps.Map | null) => void } | null>(null);
  const rafRef = useRef<number>(0);
  const prevPosRef = useRef<{ lat: number; lng: number }>({ lat: targetPosition.lat, lng: targetPosition.lng });
  const targetPosRef = useRef<{ lat: number; lng: number }>({ lat: targetPosition.lat, lng: targetPosition.lng });
  const currentPosRef = useRef<{ lat: number; lng: number }>({ lat: targetPosition.lat, lng: targetPosition.lng });
  const headingRef = useRef<number>(0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const ambIdRef = useRef(ambulance.id);
  ambIdRef.current = ambulance.id;

  useEffect(() => {
    prevPosRef.current = { ...currentPosRef.current };
    targetPosRef.current = { lat: targetPosition.lat, lng: targetPosition.lng };
  }, [targetPosition.lat, targetPosition.lng]);

  useEffect(() => {
    if (!map) return;

    class AmbOverlayView extends google.maps.OverlayView {
      container: HTMLDivElement | null = null;

      override onAdd() {
        this.container = document.createElement('div');
        this.container.style.position = 'absolute';
        this.container.style.transform = 'translate(-50%, -50%)';
        this.container.style.zIndex = '200';
        this.container.style.cursor = 'pointer';
        this.container.addEventListener('click', () => onSelectRef.current(ambIdRef.current));
        const panes = this.getPanes();
        // Use floatPane — ABOVE all polylines and markers
        if (panes) {
          (panes.floatPane ?? panes.overlayLayer).appendChild(this.container);
        }
        containerRef.current = this.container;
        setPortalTarget(this.container);
      }

      override draw() {
        if (!this.container) return;
        const projection = this.getProjection();
        if (!projection) return;
        const pos = currentPosRef.current;
        const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(pos.lat, pos.lng));
        if (point) {
          this.container.style.left = `${point.x}px`;
          this.container.style.top = `${point.y}px`;
        }
      }

      override onRemove() {
        if (this.container) {
          if (this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
          }
        }
        this.container = null;
      }
    }

    const overlay = new AmbOverlayView();
    overlay.setMap(map);
    overlayRef.current = overlay;

    const animate = () => {
      const prev = prevPosRef.current;
      const target = targetPosRef.current;
      const current = currentPosRef.current;

      const lerpFactor = 0.25;
      current.lat += (target.lat - current.lat) * lerpFactor;
      current.lng += (target.lng - current.lng) * lerpFactor;

      const dLat = current.lat - prev.lat;
      const dLng = current.lng - prev.lng;
      if (Math.abs(dLat) > 1e-7 || Math.abs(dLng) > 1e-7) {
        headingRef.current = bearing(prev, current);
      }

      if (overlayRef.current) overlayRef.current.draw();
      if (containerRef.current) {
        containerRef.current.style.transform = `translate(-50%, -50%) rotate(${headingRef.current}deg)`;
      }
      if (labelRef.current) {
        labelRef.current.style.transform = `translate(-50%, 0) rotate(${-headingRef.current}deg)`;
      }

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      overlay.setMap(null);
      overlayRef.current = null;
    };
  }, [map]);

  if (!portalTarget) return null;

  const severityColor =
    ambulance.severity === 'CRITICAL'
      ? '#FF3B30'
      : ambulance.severity === 'URGENT'
      ? '#FFCC00'
      : '#34C759';

  const vMeta = VEHICLE_META[ambulance.vehicleType];
  const wrapSize = spriteSize + 24;

  return createPortal(
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${wrapSize}px`,
        height: `${wrapSize}px`,
      }}
    >
      {/* Drop shadow ellipse (fake 3D ground shadow) */}
      <div
        style={{
          position: 'absolute',
          top: '55%',
          left: '50%',
          width: `${spriteSize * 0.85}px`,
          height: `${spriteSize * 0.5}px`,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(0,0,0,0.55) 0%, transparent 70%)',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }}
      />

      {/* Outer glow (vehicle type color) */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: `${spriteSize + 20}px`,
          height: `${spriteSize + 20}px`,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${vMeta.color}44 0%, transparent 65%)`,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }}
      />

      {/* Severity pulse ring */}
      {ambulance.severity === 'CRITICAL' && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: `${wrapSize}px`,
            height: `${wrapSize}px`,
            borderRadius: '50%',
            border: `2px solid ${severityColor}`,
            transform: 'translate(-50%, -50%)',
            animation: 'amb-pulse 1.2s ease-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      {isSelected && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: `${wrapSize - 4}px`,
            height: `${wrapSize - 4}px`,
            borderRadius: '50%',
            border: '2px solid #007AFF',
            transform: 'translate(-50%, -50%)',
            animation: 'amb-select 2s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Vehicle sprite — 3D looking */}
      <svg
        width={spriteSize}
        height={spriteSize}
        viewBox="0 0 40 40"
        style={{
          filter: `drop-shadow(0 4px 10px rgba(0,0,0,0.9)) drop-shadow(0 0 12px ${vMeta.color})`,
        }}
      >
        <VehicleSprite
          vehicleType={ambulance.vehicleType}
          severityColor={severityColor}
        />
      </svg>

      <div
        ref={labelRef}
        style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translate(-50%, 0)',
          fontSize: '10px',
          fontWeight: 700,
          fontFamily: 'Inter, sans-serif',
          color: 'white',
          backgroundColor: 'rgba(0,0,0,0.92)',
          padding: '3px 8px',
          borderRadius: '5px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          border: `1px solid ${vMeta.color}`,
          letterSpacing: '0.02em',
          boxShadow: `0 2px 8px rgba(0,0,0,0.6), 0 0 12px ${vMeta.color}44`,
        }}
      >
        {ambulance.id}
      </div>
    </div>,
    portalTarget
  );
}

// ─── 3D Vehicle Sprites ───────────────────────────────────────────────────

function VehicleSprite({
  vehicleType,
  severityColor,
}: {
  vehicleType: VehicleType;
  severityColor: string;
}) {
  if (vehicleType === 'AMBULANCE') {
    return (
      <>
        <defs>
          <linearGradient id="ambBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="45%" stopColor="#F4F4F5" />
            <stop offset="100%" stopColor="#C7C7CC" />
          </linearGradient>
          <linearGradient id="ambStripe" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={severityColor} stopOpacity="1" />
            <stop offset="100%" stopColor={severityColor} stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="ambGlass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4A5568" />
            <stop offset="100%" stopColor="#1A202C" />
          </linearGradient>
        </defs>
        {/* Wheels visible sticking out */}
        <rect x="4" y="14" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="33" y="14" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="4" y="24" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="33" y="24" width="3" height="6" rx="1" fill="#0A0A0A" />
        {/* Body */}
        <rect x="6" y="4" width="28" height="32" rx="5" fill="url(#ambBody)" stroke="#48484A" strokeWidth="1.2" />
        {/* Windshield */}
        <rect x="10" y="7" width="20" height="5" rx="1.5" fill="url(#ambGlass)" opacity="0.85" />
        {/* Rear window */}
        <rect x="10" y="28" width="20" height="4" rx="1.5" fill="url(#ambGlass)" opacity="0.7" />
        {/* Stripe */}
        <rect x="6" y="18" width="28" height="3" fill="url(#ambStripe)" />
        {/* Red cross */}
        <rect x="17" y="11.5" width="6" height="1.8" fill={severityColor} />
        <rect x="19.1" y="9.4" width="1.8" height="6" fill={severityColor} />
        {/* Light bar */}
        <rect x="13" y="14.5" width="14" height="2" rx="0.6" fill="#1A202C" />
        <rect x="13" y="14.5" width="7" height="2" rx="0.6" fill="#FF3B30" />
        <rect x="20" y="14.5" width="7" height="2" rx="0.6" fill="#007AFF" />
        {/* Top highlight */}
        <rect x="7" y="5" width="26" height="1" rx="0.5" fill="white" opacity="0.7" />
      </>
    );
  }

  if (vehicleType === 'POLICE') {
    return (
      <>
        <defs>
          <linearGradient id="polBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="50%" stopColor="#1E40AF" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
          <linearGradient id="polGlass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4A5568" />
            <stop offset="100%" stopColor="#1A202C" />
          </linearGradient>
        </defs>
        <rect x="4" y="14" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="33" y="14" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="4" y="24" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="33" y="24" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="6" y="4" width="28" height="32" rx="5" fill="url(#polBody)" stroke="#0F172A" strokeWidth="1.2" />
        <rect x="10" y="7" width="20" height="5" rx="1.5" fill="url(#polGlass)" />
        <rect x="10" y="28" width="20" height="4" rx="1.5" fill="url(#polGlass)" opacity="0.7" />
        {/* White stripe */}
        <rect x="6" y="19" width="28" height="4" fill="#FFFFFF" opacity="0.95" />
        {/* Police text */}
        <text x="20" y="22.5" textAnchor="middle" fontSize="3.4" fontWeight="800" fill="#0F172A" fontFamily="Inter, sans-serif" letterSpacing="0.2">
          POLICE
        </text>
        {/* Light bar */}
        <rect x="12" y="14.5" width="16" height="2.2" rx="0.8" fill="#1A202C" />
        <rect x="12.5" y="15" width="7" height="1.2" rx="0.5" fill="#FF3B30" />
        <rect x="20.5" y="15" width="7" height="1.2" rx="0.5" fill="#007AFF" />
        {/* Roof highlight */}
        <rect x="7" y="5" width="26" height="1" rx="0.5" fill="white" opacity="0.4" />
      </>
    );
  }

  if (vehicleType === 'FIRE') {
    return (
      <>
        <defs>
          <linearGradient id="fireBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EF4444" />
            <stop offset="50%" stopColor="#DC2626" />
            <stop offset="100%" stopColor="#7F1D1D" />
          </linearGradient>
          <linearGradient id="fireGlass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4A5568" />
            <stop offset="100%" stopColor="#1A202C" />
          </linearGradient>
          <linearGradient id="fireYellow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
        <rect x="4" y="14" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="33" y="14" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="4" y="24" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="33" y="24" width="3" height="6" rx="1" fill="#0A0A0A" />
        <rect x="6" y="4" width="28" height="32" rx="4" fill="url(#fireBody)" stroke="#7F1D1D" strokeWidth="1.2" />
        <rect x="10" y="7" width="20" height="5" rx="1.5" fill="url(#fireGlass)" />
        {/* Yellow hazard stripes */}
        <rect x="6" y="18" width="28" height="2.5" fill="url(#fireYellow)" />
        <rect x="6" y="25" width="28" height="2.5" fill="url(#fireYellow)" />
        {/* Ladder hint */}
        <rect x="22" y="10" width="10" height="1" rx="0.3" fill="#E5E7EB" opacity="0.9" />
        <rect x="23.5" y="12" width="10" height="1" rx="0.3" fill="#E5E7EB" opacity="0.9" />
        {/* Light bar */}
        <rect x="12" y="14.5" width="16" height="2" rx="0.6" fill="#1A202C" />
        <rect x="12.5" y="15" width="15" height="1" rx="0.4" fill="#FCD34D" />
        {/* FIRE text */}
        <text x="20" y="23" textAnchor="middle" fontSize="3" fontWeight="800" fill="white" fontFamily="Inter, sans-serif">
          FIRE
        </text>
        <rect x="7" y="5" width="26" height="1" rx="0.5" fill="white" opacity="0.45" />
      </>
    );
  }

  // RESCUE
  return (
    <>
      <defs>
        <linearGradient id="rescBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ADE80" />
          <stop offset="50%" stopColor="#16A34A" />
          <stop offset="100%" stopColor="#14532D" />
        </linearGradient>
        <linearGradient id="rescGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A5568" />
          <stop offset="100%" stopColor="#1A202C" />
        </linearGradient>
      </defs>
      <rect x="4" y="14" width="3" height="6" rx="1" fill="#0A0A0A" />
      <rect x="33" y="14" width="3" height="6" rx="1" fill="#0A0A0A" />
      <rect x="4" y="24" width="3" height="6" rx="1" fill="#0A0A0A" />
      <rect x="33" y="24" width="3" height="6" rx="1" fill="#0A0A0A" />
      <rect x="6" y="4" width="28" height="32" rx="5" fill="url(#rescBody)" stroke="#14532D" strokeWidth="1.2" />
      <rect x="10" y="7" width="20" height="5" rx="1.5" fill="url(#rescGlass)" />
      <rect x="10" y="28" width="20" height="4" rx="1.5" fill="url(#rescGlass)" opacity="0.7" />
      {/* White cross stripe */}
      <rect x="6" y="19.5" width="28" height="2.5" fill="white" />
      {/* Life ring icon */}
      <circle cx="20" cy="15" r="3" fill="white" opacity="0.95" />
      <circle cx="20" cy="15" r="1.4" fill="#16A34A" />
      {/* RESCUE text */}
      <text x="20" y="23.5" textAnchor="middle" fontSize="2.9" fontWeight="800" fill="white" fontFamily="Inter, sans-serif">
        RESCUE
      </text>
      <rect x="7" y="5" width="26" height="1" rx="0.5" fill="white" opacity="0.45" />
    </>
  );
}