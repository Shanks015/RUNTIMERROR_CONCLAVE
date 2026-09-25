// World model for Smart Traffic Command Center — Bangalore traffic network

export interface Node {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  roadName: string;
  distanceKm: number;
  baseTimeMin: number;
  lanes: number;
}

export type SignalPhase = 'GREEN' | 'RED' | 'AMBER';
export type NodeMode = 'AUTO' | 'EV_PRIORITY' | 'MANUAL' | 'SCHEDULED';
export type Severity = 'CRITICAL' | 'URGENT' | 'ROUTINE';
export type AmbulanceStatus = 'idle' | 'enroute' | 'arrived';

// ─── Vehicle types ────────────────────────────────────────────────────────

export type VehicleType = 'AMBULANCE' | 'POLICE' | 'FIRE' | 'RESCUE';

export interface VehicleMeta {
  label: string;
  shortLabel: string;
  prefix: string;
  color: string;
  icon: string;
}

export const VEHICLE_META: Record<VehicleType, VehicleMeta> = {
  AMBULANCE: {
    label: 'Ambulance',
    shortLabel: 'AMB',
    prefix: 'AMB',
    color: '#FF3B30',
    icon: 'cross',
  },
  POLICE: {
    label: 'Police Van',
    shortLabel: 'POL',
    prefix: 'POL',
    color: '#007AFF',
    icon: 'shield',
  },
  FIRE: {
    label: 'Fire Truck',
    shortLabel: 'FIRE',
    prefix: 'FIRE',
    color: '#FF9500',
    icon: 'flame',
  },
  RESCUE: {
    label: 'Rescue Unit',
    shortLabel: 'RESC',
    prefix: 'RESC',
    color: '#34C759',
    icon: 'life',
  },
};

export const VEHICLE_TYPES: VehicleType[] = ['AMBULANCE', 'POLICE', 'FIRE', 'RESCUE'];

// ─── Core state interfaces ────────────────────────────────────────────────

export interface EdgeState {
  id: string;
  baseTimeMin: number;
  lanes: number;
  timeOfDayMultiplier: number;
  incidentBlocked: boolean;
  liveCongestion: number;
  currentCost: number;
}

export interface NodeState {
  id: string;
  signalPhase: SignalPhase;
  mode: NodeMode;
  queueLength: number;
  scheduledGreenAt: number | null;
  scheduledForAmbulanceId: string | null;
  homeNodeOfPolice: string[];
}

export interface AmbulanceState {
  id: string;
  vehicleType: VehicleType;
  severity: Severity;
  routeEdgeIds: string[];
  currentEdgeId: string;
  progressOnEdge: number;
  lat: number;
  lng: number;
  destinationNodeId: string;
  etaPerNode: Record<string, number>;
  remainingEtaSec: number;
  status: AmbulanceStatus;
  originNodeId: string;
  spawnTime: number;
  arrivalTime: number | null;
}

export interface IncidentState {
  id: string;
  edgeId: string | null;
  nodeId: string | null;
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  lat: number;
  lng: number;
  createdAt: number;
}

export type EventType =
  | 'signal:scheduled'
  | 'signal:preempted'
  | 'signal:unscheduled'
  | 'route:updated'
  | 'route:invalidated'
  | 'incident:new'
  | 'incident:cleared'
  | 'signal:conflict'
  | 'ambulance:arrived'
  | 'ambulance:spawned';

export interface SimEvent {
  id: string;
  type: EventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

export const NODES: Node[] = [
  { id: 'NODE-01', name: 'Silk Board Junction', lat: 12.9172, lng: 77.6229 },
  { id: 'NODE-02', name: 'Sony World Junction', lat: 12.9345, lng: 77.6135 },
  { id: 'NODE-03', name: 'Ejipura Junction', lat: 12.9430, lng: 77.6250 },
  { id: 'NODE-04', name: 'Domlur Junction', lat: 12.9610, lng: 77.6380 },
  { id: 'NODE-05', name: 'Iblur Junction', lat: 12.9225, lng: 77.6760 },
  { id: 'NODE-06', name: 'Marathahalli Bridge', lat: 12.9569, lng: 77.7011 },
  { id: 'NODE-07', name: 'Sarjapur Road Jn', lat: 12.9010, lng: 77.6870 },
  { id: 'NODE-08', name: 'Trinity Circle', lat: 12.9720, lng: 77.6200 },
  { id: 'NODE-09', name: 'Jayanagar 4th Block', lat: 12.9250, lng: 77.5830 },
  { id: 'NODE-10', name: 'Anil Kumble Circle', lat: 12.9750, lng: 77.6000 },
];

export const EDGES: Edge[] = [
  { id: 'EDGE-01-02', from: 'NODE-01', to: 'NODE-02', roadName: 'Hosur Rd', distanceKm: 2.5, baseTimeMin: 6, lanes: 4 },
  { id: 'EDGE-01-05', from: 'NODE-01', to: 'NODE-05', roadName: 'Outer Ring Rd', distanceKm: 6.5, baseTimeMin: 14, lanes: 6 },
  { id: 'EDGE-01-09', from: 'NODE-01', to: 'NODE-09', roadName: 'Kanakapura Rd', distanceKm: 4.5, baseTimeMin: 11, lanes: 3 },
  { id: 'EDGE-02-03', from: 'NODE-02', to: 'NODE-03', roadName: '80ft Rd', distanceKm: 1.5, baseTimeMin: 5, lanes: 4 },
  { id: 'EDGE-02-09', from: 'NODE-02', to: 'NODE-09', roadName: 'Koramangala Link', distanceKm: 3.5, baseTimeMin: 9, lanes: 2 },
  { id: 'EDGE-03-04', from: 'NODE-03', to: 'NODE-04', roadName: 'Inner Ring Rd', distanceKm: 2.2, baseTimeMin: 7, lanes: 4 },
  { id: 'EDGE-03-08', from: 'NODE-03', to: 'NODE-08', roadName: '100ft Rd', distanceKm: 4.0, baseTimeMin: 11, lanes: 3 },
  { id: 'EDGE-04-06', from: 'NODE-04', to: 'NODE-06', roadName: 'Old Airport Rd', distanceKm: 7.0, baseTimeMin: 16, lanes: 4 },
  { id: 'EDGE-04-08', from: 'NODE-04', to: 'NODE-08', roadName: 'Old Airport Rd', distanceKm: 1.8, baseTimeMin: 6, lanes: 4 },
  { id: 'EDGE-05-06', from: 'NODE-05', to: 'NODE-06', roadName: 'Outer Ring Rd', distanceKm: 4.5, baseTimeMin: 10, lanes: 6 },
  { id: 'EDGE-05-07', from: 'NODE-05', to: 'NODE-07', roadName: 'ORR South', distanceKm: 3.0, baseTimeMin: 8, lanes: 4 },
  { id: 'EDGE-06-07', from: 'NODE-06', to: 'NODE-07', roadName: 'ORR East', distanceKm: 6.5, baseTimeMin: 14, lanes: 6 },
  { id: 'EDGE-08-10', from: 'NODE-08', to: 'NODE-10', roadName: 'MG Road', distanceKm: 1.8, baseTimeMin: 6, lanes: 4 },
  { id: 'EDGE-09-10', from: 'NODE-09', to: 'NODE-10', roadName: 'Jayanagar-MG Rd', distanceKm: 6.0, baseTimeMin: 15, lanes: 3 },
];

export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0F0F10' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6B6B70' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0F0F10' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#1A1A1C' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#8E8E93' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#8E8E93' }] },

  { featureType: 'poi', stylers: [{ visibility: 'off' }] },

  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1C1C1E' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#252528' }] },
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'on' }, { color: '#6B6B70' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2C2C2E' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1C1C1E' }] },
  { featureType: 'road.highway', elementType: 'labels', stylers: [{ visibility: 'on' }, { color: '#8E8E93' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#161618' }] },

  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0A0A0B' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#48484A' }] },
];

export const MAP_CENTER = { lat: 12.94, lng: 77.63 };
export const MAP_ZOOM = 12;

export function getNode(id: string): Node | undefined {
  return NODES.find((n) => n.id === id);
}

export function getEdge(id: string): Edge | undefined {
  return EDGES.find((e) => e.id === id);
}

export function getOtherEnd(edge: Edge, nodeId: string): string {
  return edge.from === nodeId ? edge.to : edge.from;
}

export function getEdgesForNode(nodeId: string): Edge[] {
  return EDGES.filter((e) => e.from === nodeId || e.to === nodeId);
}

export function getEdgeBetween(fromId: string, toId: string): Edge | undefined {
  return EDGES.find(
    (e) =>
      (e.from === fromId && e.to === toId) ||
      (e.from === toId && e.to === fromId)
  );
}

export function interpolateOnEdge(edge: Edge, fromNodeId: string, progress: number): { lat: number; lng: number } {
  const fromNode = getNode(fromNodeId)!;
  const toNodeId = getOtherEnd(edge, fromNodeId);
  const toNode = getNode(toNodeId)!;
  return {
    lat: fromNode.lat + (toNode.lat - fromNode.lat) * progress,
    lng: fromNode.lng + (toNode.lng - fromNode.lng) * progress,
  };
}

export function bearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const dLng = (to.lng - from.lng) * (Math.PI / 180);
  const lat1 = from.lat * (Math.PI / 180);
  const lat2 = to.lat * (Math.PI / 180);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLng = (b.lng - a.lng) * (Math.PI / 180);
  const lat1 = a.lat * (Math.PI / 180);
  const lat2 = b.lat * (Math.PI / 180);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}