import { supabase } from './supabase';
import type { IncidentState, SimEvent } from '../data/world';

const PERSIST_EVENT_TYPES = new Set([
  'incident:new',
  'incident:cleared',
  'route:updated',
  'route:invalidated',
  'signal:conflict',
  'ambulance:spawned',
  'ambulance:arrived',
  'signal:preempted',
]);

// ─── Incidents ────────────────────────────────────────────────────────────

export async function persistIncident(incident: IncidentState): Promise<void> {
  try {
    const { error } = await supabase.from('incidents').insert({
      id: incident.id,
      edge_id: incident.edgeId,
      node_id: incident.nodeId,
      type: incident.type,
      severity: incident.severity,
      lat: incident.lat,
      lng: incident.lng,
      created_at: new Date(incident.createdAt).toISOString(),
    });
    if (error) console.error('[persist] incident insert failed:', error.message);
  } catch (err) {
    console.error('[persist] incident insert exception:', err);
  }
}

export async function markIncidentCleared(incidentId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('incidents')
      .update({ cleared_at: new Date().toISOString() })
      .eq('id', incidentId);
    if (error) console.error('[persist] incident clear failed:', error.message);
  } catch (err) {
    console.error('[persist] incident clear exception:', err);
  }
}

export async function clearAllIncidentsInDb(): Promise<void> {
  try {
    const { error } = await supabase
      .from('incidents')
      .update({ cleared_at: new Date().toISOString() })
      .is('cleared_at', null);
    if (error) console.error('[persist] clear all failed:', error.message);
  } catch (err) {
    console.error('[persist] clear all exception:', err);
  }
}

// ─── Events ───────────────────────────────────────────────────────────────

export async function persistEvent(event: SimEvent): Promise<void> {
  if (!PERSIST_EVENT_TYPES.has(event.type)) return;
  try {
    const { error } = await supabase.from('events').insert({
      id: event.id,
      event_type: event.type,
      payload: event.payload,
      created_at: new Date(event.timestamp).toISOString(),
    });
    if (error) console.error('[persist] event insert failed:', error.message);
  } catch (err) {
    console.error('[persist] event insert exception:', err);
  }
}

// ─── Queries (used by AI chat) ────────────────────────────────────────────

export interface DbIncident {
  id: string;
  edge_id: string | null;
  node_id: string | null;
  type: string;
  severity: string;
  created_at: string;
  cleared_at: string | null;
}

export interface DbEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function getRecentIncidents(limit = 20): Promise<DbIncident[]> {
  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[query] recent incidents failed:', error.message);
    return [];
  }
  return data ?? [];
}

export async function getUnresolvedIncidents(): Promise<DbIncident[]> {
  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .is('cleared_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[query] unresolved incidents failed:', error.message);
    return [];
  }
  return data ?? [];
}

export async function getRecentEvents(
  limit = 30,
  types?: string[]
): Promise<DbEvent[]> {
  let query = supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (types && types.length > 0) {
    query = query.in('event_type', types);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[query] recent events failed:', error.message);
    return [];
  }
  return data ?? [];
}

export async function getEventsOfType(
  eventType: string,
  limit = 10
): Promise<DbEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('event_type', eventType)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[query] events of type failed:', error.message);
    return [];
  }
  return data ?? [];
}

export async function getEventCountSince(
  eventType: string,
  sinceIso: string
): Promise<number> {
  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', eventType)
    .gte('created_at', sinceIso);
  if (error) {
    console.error('[query] event count failed:', error.message);
    return 0;
  }
  return count ?? 0;
}