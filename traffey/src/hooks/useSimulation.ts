import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AmbulanceState,
  type EdgeState,
  type IncidentState,
  type NodeState,
  type Severity,
  type VehicleType,
  type SimEvent,
  type EventType,
  NODES,
  EDGES,
  VEHICLE_META,
  getEdge,
  getNode,
  getOtherEnd,
  getEdgesForNode,
  getEdgeBetween,
  interpolateOnEdge,
} from '../data/world';
import {
  persistIncident,
  persistEvent,
  clearAllIncidentsInDb,
} from '../lib/persistence';

export interface SimSnapshot {
  edges: Record<string, EdgeState>;
  nodes: Record<string, NodeState>;
  ambulances: AmbulanceState[];
  incidents: IncidentState[];
  events: SimEvent[];
  simTime: number;
  running: boolean;
  speed: number;
  stats: {
    signalsPreempted: number;
    reroutes: number;
  };
}

let eventCounter = 0;
function makeEvent(type: EventType, payload: Record<string, unknown>): SimEvent {
  return { id: `evt-${eventCounter++}`, type, timestamp: Date.now(), payload };
}

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 3, URGENT: 2, ROUTINE: 1 };

function timeOfDayMultiplier(hours: number): number {
  if (hours < 5) return 0.3;
  if (hours < 7) return 0.6 + (hours - 5) * 0.4;
  if (hours < 9) return 1.0 + (hours - 7) * 0.4;
  if (hours < 10) return 1.8;
  if (hours < 12) return 1.6 - (hours - 10) * 0.3;
  if (hours < 14) return 1.0;
  if (hours < 16) return 0.9;
  if (hours < 18) return 1.1 + (hours - 16) * 0.2;
  if (hours < 20) return 1.9;
  if (hours < 22) return 1.4 - (hours - 20) * 0.3;
  return 0.5;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function aStar(
  fromNodeId: string,
  toNodeId: string,
  edgeCosts: Record<string, number>,
  blockedEdgeIds: Set<string>
): { path: string[]; edgeIds: string[]; etaPerNode: Record<string, number> } | null {
  const openSet = new Set<string>([fromNodeId]);
  const cameFrom: Record<string, string> = {};
  const gScore: Record<string, number> = {};
  const fScore: Record<string, number> = {};
  gScore[fromNodeId] = 0;
  fScore[fromNodeId] = haversineHeuristic(fromNodeId, toNodeId);

  while (openSet.size > 0) {
    let current = '';
    let lowestF = Infinity;
    for (const id of openSet) {
      const f = fScore[id] ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = id;
      }
    }
    if (current === toNodeId) {
      const nodePath: string[] = [current];
      while (cameFrom[current]) {
        current = cameFrom[current];
        nodePath.unshift(current);
      }
      const edgeIds: string[] = [];
      const etaPerNode: Record<string, number> = {};
      let cumulativeTime = 0;
      etaPerNode[nodePath[0]] = 0;
      for (let i = 0; i < nodePath.length - 1; i++) {
        const edge = getEdgeBetween(nodePath[i], nodePath[i + 1]);
        if (!edge) return null;
        edgeIds.push(edge.id);
        const cost = edgeCosts[edge.id] ?? edge.baseTimeMin;
        cumulativeTime += cost * 60;
        etaPerNode[nodePath[i + 1]] = cumulativeTime;
      }
      return { path: nodePath, edgeIds, etaPerNode };
    }

    openSet.delete(current);
    for (const edge of getEdgesForNode(current)) {
      if (blockedEdgeIds.has(edge.id)) continue;
      const neighbor = getOtherEnd(edge, current);
      const cost = edgeCosts[edge.id] ?? edge.baseTimeMin;
      const tentativeG = (gScore[current] ?? Infinity) + cost * 60;
      if (tentativeG < (gScore[neighbor] ?? Infinity)) {
        cameFrom[neighbor] = current;
        gScore[neighbor] = tentativeG;
        fScore[neighbor] = tentativeG + haversineHeuristic(neighbor, toNodeId);
        openSet.add(neighbor);
      }
    }
  }
  return null;
}

function haversineHeuristic(fromId: string, toId: string): number {
  const a = getNode(fromId);
  const b = getNode(toId);
  if (!a || !b) return 0;
  const R = 6371;
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLng = (b.lng - a.lng) * (Math.PI / 180);
  const lat1 = a.lat * (Math.PI / 180);
  const lat2 = b.lat * (Math.PI / 180);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h));
  return km * 1.2;
}

function makeInitialEdges(): Record<string, EdgeState> {
  const edges: Record<string, EdgeState> = {};
  for (const e of EDGES) {
    edges[e.id] = {
      id: e.id,
      baseTimeMin: e.baseTimeMin,
      lanes: e.lanes,
      timeOfDayMultiplier: 1.0,
      incidentBlocked: false,
      liveCongestion: 0.2,
      currentCost: e.baseTimeMin,
    };
  }
  return edges;
}

function makeInitialNodes(): Record<string, NodeState> {
  const nodes: Record<string, NodeState> = {};
  for (const n of NODES) {
    nodes[n.id] = {
      id: n.id,
      signalPhase: 'GREEN',
      mode: 'AUTO',
      queueLength: 0,
      scheduledGreenAt: null,
      scheduledForAmbulanceId: null,
      homeNodeOfPolice: [],
    };
  }
  return nodes;
}

function makeInitialSnapshot(): SimSnapshot {
  return {
    edges: makeInitialEdges(),
    nodes: makeInitialNodes(),
    ambulances: [],
    incidents: [],
    events: [],
    simTime: 0,
    running: true,
    speed: 1,
    stats: { signalsPreempted: 0, reroutes: 0 },
  };
}

export interface SpawnAmbulanceParams {
  severity: Severity;
  vehicleType?: VehicleType;
  originNodeId: string;
  destinationNodeId: string;
  id?: string;
}

export function useSimulation() {
  const [snapshot, setSnapshot] = useState<SimSnapshot>(makeInitialSnapshot);
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;

  const eventListeners = useRef<((event: SimEvent) => void)[]>([]);
  const emit = useCallback((event: SimEvent) => {
    eventListeners.current.forEach((fn) => fn(event));
    // Fire-and-forget DB persistence
    persistEvent(event).catch(() => {});
  }, []);

  const onEvent = useCallback((fn: (event: SimEvent) => void) => {
    eventListeners.current.push(fn);
    return () => {
      eventListeners.current = eventListeners.current.filter((f) => f !== fn);
    };
  }, []);

  useEffect(() => {
    if (!snapshot.running) return;
    const interval = setInterval(() => {
      tick();
    }, 1000 / snapshot.speed);
    return () => clearInterval(interval);
  }, [snapshot.running, snapshot.speed]);

  const tick = useCallback(() => {
    setSnapshot((prev) => {
      if (!prev.running) return prev;
      const now = prev.simTime + 1;
      const newEvents: SimEvent[] = [];
      let signalsPreempted = prev.stats.signalsPreempted;
      let reroutes = prev.stats.reroutes;

      const edges: Record<string, EdgeState> = {};
      for (const k in prev.edges) edges[k] = { ...prev.edges[k] };
      const nodes: Record<string, NodeState> = {};
      for (const k in prev.nodes) nodes[k] = { ...prev.nodes[k] };
      const ambulances = prev.ambulances.map((a) => ({ ...a, etaPerNode: { ...a.etaPerNode } }));
      const incidents = [...prev.incidents];

      // 1. Time-of-day congestion (with smoothing)
      const simHours = 8 + (now / 3600) * 24;
      const hoursOfDay = simHours % 24;
      for (const e of EDGES) {
        const es = edges[e.id];
        const baseMult = timeOfDayMultiplier(hoursOfDay);
        const noise = 0.97 + Math.random() * 0.06;
        es.timeOfDayMultiplier = baseMult * noise;
        const targetCongestion = clamp(es.timeOfDayMultiplier / 2.0, 0, 1);
        es.liveCongestion = es.liveCongestion * 0.92 + targetCongestion * 0.08;
        if (es.incidentBlocked) {
          es.currentCost = Infinity;
        } else {
          const lanePenalty = (4 - es.lanes) * 0.5;
          const signalPenalty = 0.5;
          es.currentCost = es.baseTimeMin * (1 + es.liveCongestion) + lanePenalty + signalPenalty;
        }
      }

      const edgeCosts: Record<string, number> = {};
      const blockedEdges = new Set<string>();
      for (const k in edges) {
        if (edges[k].incidentBlocked) {
          blockedEdges.add(k);
        } else {
          edgeCosts[k] = edges[k].currentCost;
        }
      }

      // 2. AUTO signal cycling
      const hasAnyAmbulance = ambulances.some((a) => a.status === 'enroute');
      for (const n of NODES) {
        const ns = nodes[n.id];
        if (ns.mode === 'AUTO') {
          let incomingCongestion = 0;
          let count = 0;
          for (const edge of getEdgesForNode(n.id)) {
            incomingCongestion += edges[edge.id].liveCongestion;
            count++;
          }
          const avgCongestion = count > 0 ? incomingCongestion / count : 0;
          ns.queueLength = Math.round(avgCongestion * 20);

          if (!hasAnyAmbulance) {
            ns.signalPhase = 'GREEN';
          } else {
            const greenDuration = 20 + ns.queueLength * 2;
            const cycleLength = greenDuration + 4 + 20;
            const phaseTime = now % cycleLength;
            if (phaseTime < greenDuration) {
              ns.signalPhase = 'GREEN';
            } else if (phaseTime < greenDuration + 4) {
              ns.signalPhase = 'AMBER';
            } else {
              ns.signalPhase = 'RED';
            }
          }
        }
      }

      // 3. Route new ambulances
      for (const amb of ambulances) {
        if (amb.status === 'idle' && amb.routeEdgeIds.length === 0) {
          const result = aStar(amb.originNodeId, amb.destinationNodeId, edgeCosts, blockedEdges);
          if (result) {
            amb.routeEdgeIds = result.edgeIds;
            amb.currentEdgeId = result.edgeIds[0];
            amb.progressOnEdge = 0;
            amb.etaPerNode = result.etaPerNode;
            amb.remainingEtaSec = result.etaPerNode[amb.destinationNodeId] ?? 0;
            amb.status = 'enroute';
            const origin = getNode(amb.originNodeId)!;
            amb.lat = origin.lat;
            amb.lng = origin.lng;
          }
        }
      }

      // 4. Schedule green wave
      for (const amb of ambulances) {
        if (amb.status !== 'enroute') continue;
        const ambSpawnElapsed = now - amb.spawnTime;
        const nodeSequence = getRouteNodes(amb);
        for (const nodeId of nodeSequence) {
          if (nodeId === amb.originNodeId) continue;
          const etaSec = amb.etaPerNode[nodeId];
          if (etaSec === undefined) continue;
          const absArrival = amb.spawnTime + etaSec;
          const scheduleAt = absArrival - 5;
          if (ambSpawnElapsed >= scheduleAt - ambSpawnElapsed) {
            const ns = nodes[nodeId];
            if (ns && ns.scheduledForAmbulanceId !== amb.id) {
              if (ns.scheduledForAmbulanceId === null || ns.mode !== 'SCHEDULED') {
                ns.mode = 'SCHEDULED';
                ns.scheduledGreenAt = scheduleAt;
                ns.scheduledForAmbulanceId = amb.id;
                newEvents.push(
                  makeEvent('signal:scheduled', { nodeId, scheduledGreenAt: scheduleAt, ambId: amb.id })
                );
              } else {
                const existingAmb = ambulances.find((a) => a.id === ns.scheduledForAmbulanceId);
                if (existingAmb) {
                  if (SEVERITY_RANK[amb.severity] > SEVERITY_RANK[existingAmb.severity]) {
                    newEvents.push(
                      makeEvent('signal:conflict', {
                        nodeId,
                        winnerAmbId: amb.id,
                        loserAmbId: existingAmb.id,
                        reason: 'higher severity',
                      })
                    );
                    ns.scheduledForAmbulanceId = amb.id;
                    ns.scheduledGreenAt = scheduleAt;
                    shiftAmbulanceSchedule(existingAmb, nodeId, 8, nodes);
                    signalsPreempted++;
                    newEvents.push(makeEvent('signal:preempted', { nodeId, ambId: amb.id }));
                  } else if (SEVERITY_RANK[amb.severity] === SEVERITY_RANK[existingAmb.severity]) {
                    const existingEta = existingAmb.etaPerNode[nodeId] ?? Infinity;
                    const newEta = amb.etaPerNode[nodeId] ?? Infinity;
                    if (newEta < existingEta) {
                      newEvents.push(
                        makeEvent('signal:conflict', {
                          nodeId,
                          winnerAmbId: amb.id,
                          loserAmbId: existingAmb.id,
                          reason: 'earlier ETA',
                        })
                      );
                      ns.scheduledForAmbulanceId = amb.id;
                      ns.scheduledGreenAt = scheduleAt;
                      shiftAmbulanceSchedule(existingAmb, nodeId, 8, nodes);
                      signalsPreempted++;
                      newEvents.push(makeEvent('signal:preempted', { nodeId, ambId: amb.id }));
                    } else {
                      shiftAmbulanceSchedule(amb, nodeId, 8, nodes);
                      newEvents.push(
                        makeEvent('signal:conflict', {
                          nodeId,
                          winnerAmbId: existingAmb.id,
                          loserAmbId: amb.id,
                          reason: 'earlier ETA',
                        })
                      );
                    }
                  }
                }
              }
            }
          }
        }
      }

      // 5. Move ambulances
      for (const amb of ambulances) {
        if (amb.status !== 'enroute') continue;
        const currentEdge = getEdge(amb.currentEdgeId);
        if (!currentEdge) continue;

        const edgeState = edges[amb.currentEdgeId];
        const costMin = edgeState?.incidentBlocked
          ? Infinity
          : edgeState?.currentCost ?? currentEdge.baseTimeMin;
        const speedBoost = amb.severity === 'CRITICAL' ? 2.0 : amb.severity === 'URGENT' ? 1.5 : 1.0;
        const travelTimeSec = ((costMin === Infinity ? 999 : costMin) * 60) / speedBoost;
        const progressPerTick = 1 / travelTimeSec;
        amb.progressOnEdge += progressPerTick;

        const fromNodeId =
          amb.progressOnEdge < 1
            ? getEdgeFromNode(amb, currentEdge)
            : getOtherEnd(currentEdge, getEdgeFromNode(amb, currentEdge));

        if (amb.progressOnEdge >= 1) {
          const arrivedAtNode = getOtherEnd(currentEdge, fromNodeId);
          const ns = nodes[arrivedAtNode];
          if (ns && ns.scheduledForAmbulanceId === amb.id) {
            ns.mode = 'AUTO';
            ns.scheduledGreenAt = null;
            ns.scheduledForAmbulanceId = null;
            newEvents.push(makeEvent('signal:unscheduled', { nodeId: arrivedAtNode, reason: 'ambulance passed' }));
          }

          const currentIdx = amb.routeEdgeIds.indexOf(amb.currentEdgeId);
          if (currentIdx >= 0 && currentIdx < amb.routeEdgeIds.length - 1) {
            amb.currentEdgeId = amb.routeEdgeIds[currentIdx + 1];
            amb.progressOnEdge = 0;
            const nextEdge = getEdge(amb.currentEdgeId)!;
            const pos = interpolateOnEdge(nextEdge, arrivedAtNode, 0);
            amb.lat = pos.lat;
            amb.lng = pos.lng;
          } else {
            amb.status = 'arrived';
            amb.arrivalTime = now;
            amb.remainingEtaSec = 0;
            const destNode = getNode(amb.destinationNodeId)!;
            amb.lat = destNode.lat;
            amb.lng = destNode.lng;
            newEvents.push(makeEvent('ambulance:arrived', { ambId: amb.id, nodeId: amb.destinationNodeId }));
            for (const nodeId of getRouteNodes(amb)) {
              const rns = nodes[nodeId];
              if (rns && rns.scheduledForAmbulanceId === amb.id) {
                rns.mode = 'AUTO';
                rns.scheduledGreenAt = null;
                rns.scheduledForAmbulanceId = null;
                newEvents.push(makeEvent('signal:unscheduled', { nodeId, reason: 'route completed' }));
              }
            }
          }
        } else {
          const pos = interpolateOnEdge(currentEdge, fromNodeId, amb.progressOnEdge);
          amb.lat = pos.lat;
          amb.lng = pos.lng;
        }

        if (amb.status === 'enroute') {
          const totalEta = amb.etaPerNode[amb.destinationNodeId] ?? 0;
          const elapsed = now - amb.spawnTime;
          amb.remainingEtaSec = Math.max(0, totalEta - elapsed);
        }

        if (edgeState?.incidentBlocked && amb.status === 'enroute') {
          newEvents.push(
            makeEvent('route:invalidated', { ambId: amb.id, blockedEdgeId: amb.currentEdgeId })
          );
          for (const nodeId of getRouteNodes(amb)) {
            const rns = nodes[nodeId];
            if (rns && rns.scheduledForAmbulanceId === amb.id) {
              rns.mode = 'AUTO';
              rns.scheduledGreenAt = null;
              rns.scheduledForAmbulanceId = null;
              newEvents.push(makeEvent('signal:unscheduled', { nodeId, reason: 'route invalidated' }));
            }
          }
          const currentEdge2 = getEdge(amb.currentEdgeId)!;
          const fromNode = getEdgeFromNode(amb, currentEdge2);
          const nearestNode =
            amb.progressOnEdge < 0.5 ? fromNode : getOtherEnd(currentEdge2, fromNode);
          const result = aStar(nearestNode, amb.destinationNodeId, edgeCosts, blockedEdges);
          if (result) {
            const oldRoute = [...amb.routeEdgeIds];
            amb.routeEdgeIds = result.edgeIds;
            amb.currentEdgeId = result.edgeIds[0] ?? amb.currentEdgeId;
            amb.progressOnEdge = 0;
            amb.etaPerNode = result.etaPerNode;
            amb.originNodeId = nearestNode;
            amb.spawnTime = now;
            amb.remainingEtaSec = result.etaPerNode[amb.destinationNodeId] ?? 0;
            reroutes++;
            newEvents.push(
              makeEvent('route:updated', {
                ambId: amb.id,
                oldRouteEdgeIds: oldRoute,
                newRouteEdgeIds: result.edgeIds,
                newEtaPerNode: result.etaPerNode,
                reason: 'incident blocked route',
              })
            );
          }
        }
      }

      // 6. Flip scheduled nodes to GREEN
      for (const n of NODES) {
        const ns = nodes[n.id];
        if (ns.mode === 'SCHEDULED' && ns.scheduledGreenAt !== null) {
          const amb = ambulances.find((a) => a.id === ns.scheduledForAmbulanceId);
          if (amb) {
            const elapsed = now - amb.spawnTime;
            if (elapsed >= ns.scheduledGreenAt) {
              ns.signalPhase = 'GREEN';
            }
          }
        }
      }

      for (const evt of newEvents) {
        emit(evt);
      }

      return {
        ...prev,
        edges,
        nodes,
        ambulances,
        incidents,
        simTime: now,
        events: [...newEvents, ...prev.events].slice(0, 200),
        stats: { signalsPreempted, reroutes },
      };
    });
  }, [emit]);
  const spawnAmbulance = useCallback(
    (params: SpawnAmbulanceParams) => {
      const vehicleType: VehicleType = params.vehicleType ?? 'AMBULANCE';
      const meta = VEHICLE_META[vehicleType];
      const id = params.id ?? `${meta.prefix}-${String(Math.floor(Math.random() * 900) + 100)}`;
      const origin = getNode(params.originNodeId)!;
      const amb: AmbulanceState = {
        id,
        vehicleType,
        severity: params.severity,
        routeEdgeIds: [],
        currentEdgeId: '',
        progressOnEdge: 0,
        lat: origin.lat,
        lng: origin.lng,
        destinationNodeId: params.destinationNodeId,
        etaPerNode: {},
        remainingEtaSec: 0,
        status: 'idle',
        originNodeId: params.originNodeId,
        spawnTime: snapRef.current.simTime,
        arrivalTime: null,
      };
      setSnapshot((prev) => ({
        ...prev,
        ambulances: [...prev.ambulances, amb],
        events: [
          makeEvent('ambulance:spawned', {
            ambId: id,
            vehicleType,
            severity: params.severity,
            origin: params.originNodeId,
            destination: params.destinationNodeId,
          }),
          ...prev.events,
        ].slice(0, 200),
      }));
      emit(makeEvent('ambulance:spawned', { ambId: id, vehicleType, severity: params.severity }));
    },
    [emit]
  );

  const spawnIncident = useCallback(
    (lat: number, lng: number, edgeId: string | null = null) => {
      const id = `INC-${String(Math.floor(Math.random() * 900) + 100)}`;
      const incident: IncidentState = {
        id,
        edgeId,
        nodeId: null,
        type: 'ACCIDENT',
        severity: 'WARNING',
        lat,
        lng,
        createdAt: Date.now(),
      };
      setSnapshot((prev) => {
        const edges = { ...prev.edges };
        if (edgeId && edges[edgeId]) {
          edges[edgeId] = { ...edges[edgeId], incidentBlocked: true };
        }
        const newEvent = makeEvent('incident:new', {
          id,
          edgeId,
          type: incident.type,
          severity: incident.severity,
          lat,
          lng,
        });
        emit(newEvent);
        return {
          ...prev,
          edges,
          incidents: [...prev.incidents, incident],
          events: [newEvent, ...prev.events].slice(0, 200),
        };
      });
      // Persist the incident row
      persistIncident(incident).catch(() => {});
    },
    [emit]
  );

  const clearAllIncidents = useCallback(() => {
    setSnapshot((prev) => {
      const edges: Record<string, EdgeState> = {};
      for (const k in prev.edges) {
        edges[k] = { ...prev.edges[k], incidentBlocked: false };
      }
      const newEvents: SimEvent[] = prev.incidents.map((inc) => {
        const evt = makeEvent('incident:cleared', { id: inc.id });
        emit(evt);
        return evt;
      });
      return {
        ...prev,
        edges,
        incidents: [],
        events: [...newEvents, ...prev.events].slice(0, 200),
      };
    });
    // Mark all as cleared in DB
    clearAllIncidentsInDb().catch(() => {});
  }, [emit]);

  const reset = useCallback(() => {
    setSnapshot(makeInitialSnapshot());
  }, []);

  const togglePlay = useCallback(() => {
    setSnapshot((prev) => ({ ...prev, running: !prev.running }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setSnapshot((prev) => ({ ...prev, speed }));
  }, []);

  const overrideSignal = useCallback(
    (nodeId: string, phase: 'GREEN' | 'RED' | 'AMBER') => {
      setSnapshot((prev) => {
        const nodes = { ...prev.nodes };
        if (!nodes[nodeId]) return prev;
        nodes[nodeId] = {
          ...nodes[nodeId],
          signalPhase: phase,
          mode: 'MANUAL',
        };
        const evt = makeEvent('signal:preempted', {
          nodeId,
          ambId: 'OPERATOR',
          reason: `operator forced ${phase}`,
        });
        emit(evt);
        return {
          ...prev,
          nodes,
          events: [evt, ...prev.events].slice(0, 200),
        };
      });
    },
    [emit]
  );

  const releaseNode = useCallback(
    (nodeId: string) => {
      setSnapshot((prev) => {
        const nodes = { ...prev.nodes };
        if (!nodes[nodeId]) return prev;
        nodes[nodeId] = {
          ...nodes[nodeId],
          mode: 'AUTO',
          scheduledGreenAt: null,
          scheduledForAmbulanceId: null,
        };
        const evt = makeEvent('signal:unscheduled', {
          nodeId,
          reason: 'operator released to auto',
        });
        emit(evt);
        return {
          ...prev,
          nodes,
          events: [evt, ...prev.events].slice(0, 200),
        };
      });
    },
    [emit]
  );

  return {
    snapshot,
    tick,
    spawnAmbulance,
    spawnIncident,
    clearAllIncidents,
    reset,
    togglePlay,
    setSpeed,
    onEvent,
    overrideSignal,
    releaseNode,
  };
}

function getRouteNodes(amb: AmbulanceState): string[] {
  const nodes: string[] = [];
  if (amb.routeEdgeIds.length === 0) return nodes;
  const firstEdge = getEdge(amb.routeEdgeIds[0]);
  if (!firstEdge) return nodes;
  let prevNode = amb.originNodeId;
  nodes.push(prevNode);
  for (const edgeId of amb.routeEdgeIds) {
    const edge = getEdge(edgeId);
    if (!edge) continue;
    const nextNode = getOtherEnd(edge, prevNode);
    nodes.push(nextNode);
    prevNode = nextNode;
  }
  return nodes;
}

function getEdgeFromNode(amb: AmbulanceState, edge: { from: string; to: string }): string {
  const routeNodes = getRouteNodes(amb);
  const idx = routeNodes.indexOf(edge.from);
  if (idx >= 0 && routeNodes[idx + 1] === edge.to) return edge.from;
  const idx2 = routeNodes.indexOf(edge.to);
  if (idx2 >= 0 && routeNodes[idx2 + 1] === edge.from) return edge.to;
  return edge.from === amb.originNodeId ? edge.from : edge.to;
}

function shiftAmbulanceSchedule(
  amb: AmbulanceState,
  atNodeId: string,
  shiftSec: number,
  nodes: Record<string, NodeState>
) {
  const routeNodes = getRouteNodes(amb);
  const idx = routeNodes.indexOf(atNodeId);
  if (idx < 0) return;
  for (let i = idx; i < routeNodes.length; i++) {
    const nodeId = routeNodes[i];
    const ns = nodes[nodeId];
    if (ns && ns.scheduledForAmbulanceId === amb.id && ns.scheduledGreenAt !== null) {
      ns.scheduledGreenAt += shiftSec;
    }
    if (amb.etaPerNode[nodeId] !== undefined) {
      amb.etaPerNode[nodeId] += shiftSec;
    }
  }
}