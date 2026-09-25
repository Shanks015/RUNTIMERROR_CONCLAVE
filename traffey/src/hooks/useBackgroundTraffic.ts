import { useEffect, useRef, useState } from 'react';
import { EDGES, getEdge } from '../data/world';

export type BgCar = {
  id: string;
  edgeId: string;
  progress: number;
  speed: number;
  variant: 0 | 1 | 2;
  reroutedUntil?: number;
};

const CARS_PER_EDGE_BASE = 3;
const CARS_PER_EDGE_MAX = 8;
const TICK_MS = 100;

export function useBackgroundTraffic(
  edges: Record<string, { liveCongestion: number; incidentBlocked: boolean }>,
  nodes: Record<string, { signalPhase: 'GREEN' | 'RED' | 'AMBER'; mode: string }>
) {
  const [cars, setCars] = useState<BgCar[]>([]);
  const edgesRef = useRef(edges);
  const nodesRef = useRef(nodes);
  edgesRef.current = edges;
  nodesRef.current = nodes;

  const prevBlockedRef = useRef<Set<string>>(new Set());

  // Initial seed
  useEffect(() => {
    const initial: BgCar[] = [];
    for (const edge of EDGES) {
      const state = edgesRef.current[edge.id];
      if (!state || state.incidentBlocked) continue;
      const count = CARS_PER_EDGE_BASE + Math.floor(state.liveCongestion * 4);
      for (let i = 0; i < count; i++) {
        initial.push({
          id: `${edge.id}-bg-${i}`,
          edgeId: edge.id,
          progress: Math.random(),
          speed: 0.8 + Math.random() * 0.4,
          variant: Math.floor(Math.random() * 3) as 0 | 1 | 2,
        });
      }
    }
    setCars(initial);
  }, []);

  // Main tick
  useEffect(() => {
    const interval = setInterval(() => {
      const blockedNow = new Set<string>();
      for (const edgeId in edgesRef.current) {
        if (edgesRef.current[edgeId].incidentBlocked) blockedNow.add(edgeId);
      }
      const newlyBlocked: string[] = [];
      blockedNow.forEach((id) => {
        if (!prevBlockedRef.current.has(id)) newlyBlocked.push(id);
      });
      prevBlockedRef.current = blockedNow;

      setCars((prev) => {
        const next: BgCar[] = [];

        for (const car of prev) {
          const edge = getEdge(car.edgeId);
          if (!edge) continue;
          const edgeState = edgesRef.current[car.edgeId];
          if (!edgeState) continue;

          // Blocked edge — despawn
          if (edgeState.incidentBlocked) continue;

          // Signal-based slowdown near destination node
          const destNodeId = edge.to;
          const destNode = nodesRef.current[destNodeId];
          const destPhase = destNode?.signalPhase ?? 'GREEN';

          let signalSlowdown = 1;
          if (car.progress > 0.85) {
            if (destPhase === 'RED') signalSlowdown = 0.02; // basically parked
            else if (destPhase === 'AMBER') signalSlowdown = 0.25;
          } else if (car.progress > 0.6) {
            if (destPhase === 'RED') signalSlowdown = 0.3;
          }

          // Congestion slowdown — strong, so red roads look jammed
          const congestionSlowdown = Math.max(0.05, 1 - edgeState.liveCongestion * 0.95);

          const baseStep = (1 / 300) * car.speed;
          const step = baseStep * congestionSlowdown * signalSlowdown;

          let newProgress = car.progress + step;
          if (newProgress >= 1) newProgress = 0;

          const reroutedUntil =
            car.reroutedUntil && car.reroutedUntil > Date.now() ? car.reroutedUntil : undefined;

          next.push({ ...car, progress: newProgress, reroutedUntil });
        }

        // Reroute burst on newly blocked edges
        const now = Date.now();
        for (const blockedId of newlyBlocked) {
          const blockedEdge = EDGES.find((e) => e.id === blockedId);
          if (!blockedEdge) continue;

          const siblings = EDGES.filter(
            (e) =>
              e.id !== blockedId &&
              !edgesRef.current[e.id]?.incidentBlocked &&
              (e.from === blockedEdge.from ||
                e.to === blockedEdge.from ||
                e.from === blockedEdge.to ||
                e.to === blockedEdge.to)
          );

          if (siblings.length === 0) continue;

          for (let i = 0; i < 8; i++) {
            const sib = siblings[i % siblings.length];
            next.push({
              id: `${sib.id}-reroute-${now}-${i}`,
              edgeId: sib.id,
              progress: Math.random() * 0.35,
              speed: 0.9 + Math.random() * 0.4,
              variant: Math.floor(Math.random() * 3) as 0 | 1 | 2,
              reroutedUntil: now + 8000,
            });
          }
        }

        return next;
      });
    }, TICK_MS);

    return () => clearInterval(interval);
  }, []);

  // Periodic population balance
  useEffect(() => {
    const pruneInterval = setInterval(() => {
      setCars((prev) => {
        const byEdge: Record<string, BgCar[]> = {};
        for (const car of prev) (byEdge[car.edgeId] ||= []).push(car);

        const next: BgCar[] = [];
        for (const edge of EDGES) {
          const state = edgesRef.current[edge.id];
          if (!state || state.incidentBlocked) continue;

          const existing = byEdge[edge.id] ?? [];
          const target = Math.min(
            CARS_PER_EDGE_MAX,
            CARS_PER_EDGE_BASE + Math.floor(state.liveCongestion * 5)
          );

          if (existing.length >= target) {
            for (let i = 0; i < target; i++) next.push(existing[i]);
          } else {
            for (const c of existing) next.push(c);
            for (let i = existing.length; i < target; i++) {
              next.push({
                id: `${edge.id}-bg-${Date.now()}-${i}`,
                edgeId: edge.id,
                progress: Math.random(),
                speed: 0.8 + Math.random() * 0.4,
                variant: Math.floor(Math.random() * 3) as 0 | 1 | 2,
              });
            }
          }
        }
        return next;
      });
    }, 3000);

    return () => clearInterval(pruneInterval);
  }, []);

  return cars;
}