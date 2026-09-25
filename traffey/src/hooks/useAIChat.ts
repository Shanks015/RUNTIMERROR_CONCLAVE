import { useCallback, useRef, useState } from 'react';
import {
  getNode,
  NODES,
  VEHICLE_META,
  type AmbulanceState,
  type IncidentState,
  type NodeState,
  type EdgeState,
} from '../data/world';
import {
  getRecentIncidents,
  getUnresolvedIncidents,
  getRecentEvents,
  getEventCountSince,
} from '../lib/persistence';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_TOOL_TURNS = 6;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolSuccess?: boolean;
}

export interface SimActions {
  overrideSignal: (nodeId: string, phase: 'GREEN' | 'RED' | 'AMBER') => void;
  releaseNode: (nodeId: string) => void;
  spawnIncident: (lat: number, lng: number, edgeId: string | null) => void;
  clearAllIncidents: () => void;
  setSpeed: (speed: number) => void;
  focusNode: (nodeId: string | null) => void;
}

const NODE_REFERENCE = NODES.map((n) => `${n.id}=${n.name}`).join(', ');

const SYSTEM_PROMPT = `You are an AI traffic operations co-pilot for a Bangalore traffic control center (like ASTraM). You monitor the network and control signals.

Emergency vehicle fleet (use these names in replies):
- AMBULANCE — medical emergency (red)
- POLICE — law enforcement (blue)
- FIRE — fire truck (orange)
- RESCUE — rescue unit (green)
Each has a severity: CRITICAL, URGENT, or ROUTINE.

Live junctions (use these exact IDs): ${NODE_REFERENCE}

You have TWO sources of information:
1. CURRENT STATE — provided inline as JSON at the start of every conversation
2. HISTORICAL DATA — stored in a database; use the query tools to fetch it

────────────────────────────────────────
TRAFFIC REROUTING vs EMERGENCY VEHICLE REROUTING
────────────────────────────────────────
There are TWO distinct kinds of "rerouting" in this system. Do NOT confuse them.

A. Traffic rerouting (background cars): When an incident blocks a road, background traffic on that road is automatically redirected to adjacent roads. This is a REAL-TIME state — read it directly from the inline state field \`trafficRerouting\`:
   - If \`trafficRerouting.active === true\` → "Yes, traffic rerouting is happening" and name the blocked edges from \`trafficRerouting.blockedEdges\`.
   - If \`trafficRerouting.active === false\` → "No, no roads are currently blocked."

B. Emergency vehicle rerouting (an ambulance/police/fire/rescue vehicle switching to a new route around an obstacle): This is HISTORICAL — you MUST call \`get_recent_reroutes\` to answer any question about it.

If the operator asks "is traffic rerouting happening?" they mean A → use inline state.
If the operator asks "is AMB-01 rerouting?" or "why did the last vehicle reroute?" they mean B → call \`get_recent_reroutes\`.

────────────────────────────────────────
TOOL USE RULES
────────────────────────────────────────
⚠️ CRITICAL: For ANY question involving historical events, counts, or "what happened earlier", you MUST call the relevant query tool BEFORE answering. Do NOT answer from the inline state alone for those questions.

Required tool calls:
- "Is traffic rerouting happening?" → answer from \`trafficRerouting.active\` (inline, no tool)
- "Is AMB-01 rerouting?" / "Is any EV rerouting?" → call \`get_recent_reroutes\` FIRST
- "What caused the last reroute?" → call \`get_recent_reroutes\` FIRST
- "How many preemptions in the last hour?" → call \`get_preemption_count\` FIRST
- "Which incidents are unresolved?" → call \`get_unresolved_incidents\` FIRST
- "What happened recently?" → call \`get_recent_events\` FIRST
- "Show me recent incidents" → call \`get_recent_incidents\` FIRST

Only after the tool returns data, give your answer. If the tool says "No reroutes in history", then you may say "no reroutes have occurred".

────────────────────────────────────────
STYLE
────────────────────────────────────────
- Keep replies to 1-3 short sentences
- Use junction names in replies, IDs in tool calls
- Reference vehicle IDs by their exact name (AMB-01, POL-02, FIRE-03, RESC-04)
- Never end with "let me know if..." or "feel free to..." or "would you like to..."
- Skip disclaimers, skip "I"
- If you want to suggest a next action, make it specific: "Try running the ORR Blockage scenario" not "would you like to run a scenario?"`;

const TOOLS = [
  // ── ACTION TOOLS ──
  {
    type: 'function',
    function: {
      name: 'override_signal',
      description: 'Force a junction signal to a specific phase.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', enum: NODES.map((n) => n.id) },
          phase: { type: 'string', enum: ['GREEN', 'RED', 'AMBER'] },
        },
        required: ['nodeId', 'phase'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'release_signal',
      description: 'Release a junction back to automatic cycling.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', enum: NODES.map((n) => n.id) },
        },
        required: ['nodeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus_map',
      description: 'Zoom the operator map camera onto a specific junction.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', enum: NODES.map((n) => n.id) },
        },
        required: ['nodeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reset_view',
      description: 'Zoom the map back to the full city overview.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_incidents',
      description: 'Clear all active incidents from the network.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_simulation_speed',
      description: 'Change simulation speed. 1x, 2x, or 5x.',
      parameters: {
        type: 'object',
        properties: {
          speed: { type: 'number', enum: [1, 2, 5] },
        },
        required: ['speed'],
      },
    },
  },

  // ── HISTORICAL QUERY TOOLS ──
  {
    type: 'function',
    function: {
      name: 'get_recent_incidents',
      description:
        'Fetch the most recent incidents from the database (most recent first). Use for questions about past incidents.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many to fetch (default 10)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_unresolved_incidents',
      description: 'List all incidents that are still active (not yet cleared).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_reroutes',
      description:
        'Fetch the most recent EMERGENCY VEHICLE reroutes (route:updated and route:invalidated events). Use to answer "why did the last vehicle reroute" or "is any vehicle rerouting". Do NOT use this for background traffic rerouting — that is answered from inline state.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many to fetch (default 5)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_events',
      description: 'Fetch recent events of any type. Optional filter by event_type.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          event_type: {
            type: 'string',
            description:
              'Optional filter. Options: incident:new, incident:cleared, route:updated, route:invalidated, signal:conflict, ambulance:spawned, ambulance:arrived, signal:preempted.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_preemption_count',
      description: 'Count how many signals have been preempted in the last N minutes.',
      parameters: {
        type: 'object',
        properties: {
          minutes: {
            type: 'number',
            description: 'Look-back window in minutes (default 60)',
          },
        },
      },
    },
  },
] as const;

export function useAIChat(
  nodes: Record<string, NodeState>,
  edges: Record<string, EdgeState>,
  ambulances: AmbulanceState[],
  incidents: IncidentState[],
  stats: { signalsPreempted: number; reroutes: number },
  simActions: SimActions
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const buildNetworkSummary = useCallback(() => {
    const congested = Object.values(edges)
      .filter((e) => e.liveCongestion > 0.7 || e.incidentBlocked)
      .map((e) => ({
        id: e.id,
        congestion: Math.round(e.liveCongestion * 100),
        blocked: e.incidentBlocked,
      }));

    // Traffic rerouting: any blocked edge triggers background vehicle redirection
    const blockedEdges = Object.values(edges).filter((e) => e.incidentBlocked);
    const hasActiveTrafficRerouting = blockedEdges.length > 0;
    const blockedEdgeIds = blockedEdges.map((e) => e.id);

    return {
      junctions: Object.values(nodes).map((n) => ({
        id: n.id,
        name: getNode(n.id)?.name ?? n.id,
        signal: n.signalPhase,
        mode: n.mode,
        queue: n.queueLength,
      })),
      heavyRoads: congested.slice(0, 8),
      activeIncidents: incidents.map((i) => ({
        id: i.id,
        type: i.type,
        edge: i.edgeId,
      })),
      activeEmergencyVehicles: ambulances
        .filter((a) => a.status === 'enroute')
        .map((a) => ({
          id: a.id,
          type: VEHICLE_META[a.vehicleType].label,
          typeCode: a.vehicleType,
          severity: a.severity,
          from: getNode(a.originNodeId)?.name,
          to: getNode(a.destinationNodeId)?.name,
          etaMin: Math.round((a.remainingEtaSec ?? 0) / 60),
        })),
      trafficRerouting: {
        active: hasActiveTrafficRerouting,
        blockedEdges: blockedEdgeIds,
        summary: hasActiveTrafficRerouting
          ? `Background traffic is being redirected around ${blockedEdges.length} blocked road${blockedEdges.length === 1 ? '' : 's'}: ${blockedEdgeIds.join(', ')}`
          : 'No traffic rerouting in progress — no blocked edges',
      },
      stats: {
        signalsPreempted: stats.signalsPreempted,
        reroutes: stats.reroutes,
      },
    };
  }, [nodes, edges, ambulances, incidents, stats]);

  const executeTool = useCallback(
    async (
      name: string,
      args: Record<string, unknown>
    ): Promise<{ success: boolean; message: string }> => {
      try {
        switch (name) {
          case 'override_signal': {
            const nodeId = String(args.nodeId ?? '');
            const phase = String(args.phase ?? '') as 'GREEN' | 'RED' | 'AMBER';
            if (!getNode(nodeId)) return { success: false, message: `Unknown junction ${nodeId}` };
            if (!['GREEN', 'RED', 'AMBER'].includes(phase)) {
              return { success: false, message: `Invalid phase ${phase}` };
            }
            simActions.overrideSignal(nodeId, phase);
            return { success: true, message: `${getNode(nodeId)!.name} forced to ${phase}` };
          }
          case 'release_signal': {
            const nodeId = String(args.nodeId ?? '');
            if (!getNode(nodeId)) return { success: false, message: `Unknown junction ${nodeId}` };
            simActions.releaseNode(nodeId);
            return { success: true, message: `${getNode(nodeId)!.name} released to auto` };
          }
          case 'focus_map': {
            const nodeId = String(args.nodeId ?? '');
            if (!getNode(nodeId)) return { success: false, message: `Unknown junction ${nodeId}` };
            simActions.focusNode(nodeId);
            return { success: true, message: `Camera focused on ${getNode(nodeId)!.name}` };
          }
          case 'reset_view': {
            simActions.focusNode(null);
            return { success: true, message: 'Camera reset to city view' };
          }
          case 'clear_incidents': {
            const count = incidents.length;
            simActions.clearAllIncidents();
            return { success: true, message: `Cleared ${count} incident${count === 1 ? '' : 's'}` };
          }
          case 'set_simulation_speed': {
            const speed = Number(args.speed);
            if (![1, 2, 5].includes(speed)) {
              return { success: false, message: 'Speed must be 1, 2, or 5' };
            }
            simActions.setSpeed(speed);
            return { success: true, message: `Simulation speed set to ${speed}x` };
          }

          case 'get_recent_incidents': {
            const limit = Number(args.limit ?? 10);
            const rows = await getRecentIncidents(limit);
            if (rows.length === 0) return { success: true, message: 'No incidents found in history' };
            const formatted = rows.map(
              (r) =>
                `${r.id} · ${r.type} · ${r.severity} · created ${new Date(r.created_at).toLocaleTimeString()} · ${r.cleared_at ? 'CLEARED' : 'ACTIVE'}`
            );
            return { success: true, message: formatted.join('\n') };
          }
          case 'get_unresolved_incidents': {
            const rows = await getUnresolvedIncidents();
            if (rows.length === 0) return { success: true, message: 'No unresolved incidents' };
            const formatted = rows.map(
              (r) =>
                `${r.id} · ${r.type} · ${r.severity} · ${new Date(r.created_at).toLocaleTimeString()}`
            );
            return { success: true, message: formatted.join('\n') };
          }
          case 'get_recent_reroutes': {
            const limit = Number(args.limit ?? 5);
            const rows = await getRecentEvents(limit, ['route:updated', 'route:invalidated']);
            if (rows.length === 0) return { success: true, message: 'No reroutes in history' };
            const formatted = rows.map(
              (r) =>
                `${r.event_type} · ${JSON.stringify(r.payload).slice(0, 200)} · ${new Date(r.created_at).toLocaleTimeString()}`
            );
            return { success: true, message: formatted.join('\n') };
          }
          case 'get_recent_events': {
            const limit = Number(args.limit ?? 20);
            const types = args.event_type ? [String(args.event_type)] : undefined;
            const rows = await getRecentEvents(limit, types);
            if (rows.length === 0) return { success: true, message: 'No events found' };
            const formatted = rows.map(
              (r) =>
                `${r.event_type} · ${JSON.stringify(r.payload).slice(0, 150)} · ${new Date(r.created_at).toLocaleTimeString()}`
            );
            return { success: true, message: formatted.join('\n') };
          }
          case 'get_preemption_count': {
            const minutes = Number(args.minutes ?? 60);
            const sinceIso = new Date(Date.now() - minutes * 60_000).toISOString();
            const count = await getEventCountSince('signal:preempted', sinceIso);
            return {
              success: true,
              message: `${count} preemptions in the last ${minutes} minutes`,
            };
          }

          default:
            return { success: false, message: `Unknown tool ${name}` };
        }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : 'Tool failed' };
      }
    },
    [simActions, incidents]
  );

  const send = useCallback(
    async (userText: string) => {
      if (!GROQ_API_KEY) {
        setError('No Groq API key — add VITE_GROQ_API_KEY to .env');
        return;
      }
      if (inFlightRef.current || !userText.trim()) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: userText.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setError(null);
      inFlightRef.current = true;

      try {
        const history: Array<Record<string, unknown>> = [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'system',
            content: `Current network state:\n${JSON.stringify(buildNetworkSummary(), null, 2)}`,
          },
        ];

        for (const m of messages.slice(-8)) {
          if (m.role === 'user' || (m.role === 'assistant' && m.content)) {
            history.push({ role: m.role, content: m.content });
          }
        }
        history.push({ role: 'user', content: userText.trim() });

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const res = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'openai/gpt-oss-120b',
              messages: history,
              tools: TOOLS,
              tool_choice: 'auto',
              max_tokens: 600,
              temperature: 0.3,
            }),
          });

          if (!res.ok) {
            const body = await res.text();
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 150)}`);
          }

          const data = await res.json();
          const choice = data?.choices?.[0];
          const msg = choice?.message;

          if (!msg) throw new Error('Empty model response');

          const toolCalls = msg.tool_calls as
            | Array<{ id: string; function: { name: string; arguments: string } }>
            | undefined;

          if (!toolCalls || toolCalls.length === 0) {
            const text = (msg.content ?? '').trim();
            if (text) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: text,
                  timestamp: Date.now(),
                },
              ]);
            }
            return;
          }

          history.push({
            role: 'assistant',
            content: msg.content ?? null,
            tool_calls: toolCalls,
          });

          for (const call of toolCalls) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(call.function.arguments || '{}');
            } catch {
              parsedArgs = {};
            }

            const result = await executeTool(call.function.name, parsedArgs);

            setMessages((prev) => [
              ...prev,
              {
                id: `tool-${call.id}-${Date.now()}`,
                role: 'tool',
                content: result.message,
                timestamp: Date.now(),
                toolName: call.function.name,
                toolArgs: parsedArgs,
                toolSuccess: result.success,
              },
            ]);

            history.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'Done.',
            timestamp: Date.now(),
          },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: `Sorry — ${msg}`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setLoading(false);
        inFlightRef.current = false;
      }
    },
    [messages, buildNetworkSummary, executeTool]
  );

  const clear = useCallback(() => setMessages([]), []);

  return { messages, loading, error, send, clear };
}