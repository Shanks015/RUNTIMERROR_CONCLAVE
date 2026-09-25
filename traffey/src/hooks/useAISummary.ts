import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getNode,
  type AmbulanceState,
  type IncidentState,
  type NodeState,
  type EdgeState,
} from '../data/world';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface AISummaryState {
  text: string;
  updatedAt: number;
  loading: boolean;
  error: string | null;
}

const SYSTEM_PROMPT = `You are a Bangalore traffic operations analyst. Write a 2-3 sentence briefing for the operator from the given live state.

Rules:
- Plain English, no jargon, no bullets
- Name specific junctions and numbers
- If ambulance active: describe its mission, ETA, progress
- If incidents: state what's blocked and what's being done
- If nothing: one sentence + suggest a next action
- Never say "I" or refer to yourself`;

export function useAISummary(
  nodes: Record<string, NodeState>,
  edges: Record<string, EdgeState>,
  ambulances: AmbulanceState[],
  incidents: IncidentState[],
  stats: { signalsPreempted: number; reroutes: number }
) {
  const [state, setState] = useState<AISummaryState>({
    text: '',
    updatedAt: 0,
    loading: false,
    error: null,
  });

  const inFlightRef = useRef(false);
  const lastRequestRef = useRef(0);

  const generate = useCallback(
    async (force = false) => {
      if (!GROQ_API_KEY) {
        setState((s) => ({
          ...s,
          error: 'No Groq API key — add VITE_GROQ_API_KEY to .env',
        }));
        return;
      }
      if (inFlightRef.current) return;

      const now = Date.now();
      if (!force && lastRequestRef.current !== 0 && now - lastRequestRef.current < 3000) {
        return;
      }

      const snapshot = {
        activeAmbulances: ambulances
          .filter((a) => a.status === 'enroute')
          .map((a) => ({
            id: a.id,
            severity: a.severity,
            from: getNode(a.originNodeId)?.name ?? a.originNodeId,
            to: getNode(a.destinationNodeId)?.name ?? a.destinationNodeId,
            etaMin: Math.round((a.remainingEtaSec ?? 0) / 60),
            progressPct: a.routeEdgeIds.length
              ? Math.round(
                  ((a.routeEdgeIds.indexOf(a.currentEdgeId) + a.progressOnEdge) /
                    a.routeEdgeIds.length) *
                    100
                )
              : 0,
          })),
        activeIncidents: incidents.map((i) => ({
          id: i.id,
          type: i.type,
          edge: i.edgeId,
        })),
        problemJunctions: Object.values(nodes)
          .filter((n) => n.queueLength > 5 || n.mode !== 'AUTO' || n.signalPhase === 'RED')
          .slice(0, 5)
          .map((n) => ({
            id: n.id,
            name: getNode(n.id)?.name ?? n.id,
            signal: n.signalPhase,
            mode: n.mode,
            queue: n.queueLength,
          })),
        stats,
      };

      lastRequestRef.current = now;
      inFlightRef.current = true;
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'openai/gpt-oss-120b',  // ← Updated model
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: `Live state:\n${JSON.stringify(snapshot, null, 2)}\n\nBriefing:`,
              },
            ],
            max_tokens: 500,  // ← Increased for reasoning models
            temperature: 0.3,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          if (res.status === 429) {
            throw new Error('Rate limited — wait a moment and refresh');
          }
          throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content?.trim() ?? '';

        console.log('[ai] response:', data);
        console.log('[ai] extracted text:', text);

        if (!text) {
          throw new Error('Model returned empty response — reasoning may have used all tokens');
        }

        setState({
          text,
          updatedAt: Date.now(),
          loading: false,
          error: null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[ai] summary failed:', msg);
        setState((s) => ({
          ...s,
          loading: false,
          error: msg,
        }));
      } finally {
        inFlightRef.current = false;
      }
    },
    [nodes, edges, ambulances, incidents, stats]
  );

  useEffect(() => {
    generate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, refresh: () => generate(true) };
}