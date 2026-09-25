import { useEffect, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { EDGES, NODES } from '../data/world';

const CACHE_KEY = 'traffy:snapped-edges:v3';
const OLD_CACHE_KEYS = ['traffy:snapped-edges:v1', 'traffy:snapped-edges:v2'];

export type SnappedPath = { lat: number; lng: number }[];
export type SnapStatus = 'loading' | 'snapped' | 'partial' | 'fallback' | 'cached';

function decodePolyline(encoded: string): SnappedPath {
  const points: SnappedPath = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

async function fetchSnappedPath(
  service: google.maps.DirectionsService,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<SnappedPath> {
  return new Promise((resolve, reject) => {
    service.route(
      {
        origin: new google.maps.LatLng(from.lat, from.lng),
        destination: new google.maps.LatLng(to.lat, to.lng),
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === 'OK' && result?.routes?.[0]) {
          const encoded = result.routes[0].overview_polyline;
          const points = decodePolyline(
            typeof encoded === 'string' ? encoded : (encoded as any).points ?? ''
          );
          resolve(points);
        } else {
          reject(new Error(`Directions status: ${status}`));
        }
      }
    );
  });
}

export function useSnappedEdges() {
  const routesLib = useMapsLibrary('routes');
  const [paths, setPaths] = useState<Record<string, SnappedPath>>({});
  const [status, setStatus] = useState<SnapStatus>('loading');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    for (const k of OLD_CACHE_KEYS) {
      try { localStorage.removeItem(k); } catch {}
    }

    // Try cache first — doesn't need SDK
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, SnappedPath>;
        const keys = Object.keys(parsed);
        if (keys.length === EDGES.length) {
          const allSnapped = keys.every((k) => parsed[k].length > 2);
          console.log('[snap] loaded from cache, allSnapped:', allSnapped);
          setPaths(parsed);
          setStatus(allSnapped ? 'cached' : 'partial');
          setLoading(false);
          return;
        }
      }
    } catch {}

    // Wait for routes library to load
    if (!routesLib) {
      console.log('[snap] waiting for routes library...');
      return;
    }

    console.log('[snap] routes library ready');

    const run = async () => {
      let service: google.maps.DirectionsService;
      try {
        service = new routesLib.DirectionsService();
      } catch (err) {
        console.error('[snap] failed to create DirectionsService:', err);
        // Fall back to straight lines
        const fallback: Record<string, SnappedPath> = {};
        for (const edge of EDGES) {
          const fromNode = NODES.find((n) => n.id === edge.from)!;
          const toNode = NODES.find((n) => n.id === edge.to)!;
          fallback[edge.id] = [
            { lat: fromNode.lat, lng: fromNode.lng },
            { lat: toNode.lat, lng: toNode.lng },
          ];
        }
        if (!cancelled) {
          setPaths(fallback);
          setStatus('fallback');
          setLoading(false);
        }
        return;
      }

      const result: Record<string, SnappedPath> = {};
      let snappedCount = 0;
      let fallbackCount = 0;

      for (const edge of EDGES) {
        if (cancelled) return;
        const fromNode = NODES.find((n) => n.id === edge.from)!;
        const toNode = NODES.find((n) => n.id === edge.to)!;
        const fallback: SnappedPath = [
          { lat: fromNode.lat, lng: fromNode.lng },
          { lat: toNode.lat, lng: toNode.lng },
        ];

        try {
          const snapped = await fetchSnappedPath(service, fromNode, toNode);
          if (snapped.length >= 3) {
            result[edge.id] = snapped;
            snappedCount++;
            console.log(`[snap] ${edge.id}: SNAPPED (${snapped.length} pts)`);
          } else {
            result[edge.id] = fallback;
            fallbackCount++;
            console.warn(`[snap] ${edge.id}: too few points, fallback`);
          }
        } catch (err) {
          result[edge.id] = fallback;
          fallbackCount++;
          console.error(`[snap] ${edge.id}: FAILED —`, err);
        }

        // Rate-limit friendly delay
        await new Promise((r) => setTimeout(r, 100));
      }

      if (cancelled) return;

      try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); } catch {}

      console.log(`[snap] done: ${snappedCount} snapped, ${fallbackCount} fallback`);

      setPaths(result);
      setStatus(
        fallbackCount === 0 ? 'snapped' :
        snappedCount === 0 ? 'fallback' :
        'partial'
      );
      setLoading(false);
    };

    run();

    return () => { cancelled = true; };
  }, [routesLib]);

  return { paths, loading, status };
}

export function closestIndexOnPath(
  path: SnappedPath,
  point: { lat: number; lng: number }
): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const dLat = path[i].lat - point.lat;
    const dLng = path[i].lng - point.lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}