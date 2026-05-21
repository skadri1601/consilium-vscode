/**
 * Vanilla TS webview for the live debate panel. Bundled separately
 * from the extension via esbuild (target: browser, format: iife) so
 * it never touches Node APIs and stays small.
 *
 * Listens for postMessage from the extension host:
 *   { type: "event", event: <DebateEvent> }
 *   { type: "reset" }
 */

import debateCss from "./debate.css";

const styleEl = document.createElement("style");
styleEl.textContent = debateCss;
document.head.appendChild(styleEl);

interface VsCodeApi {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState<T>(): T | undefined;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

type DebateEvent = {
  type?: string;
  event?: string;
  agent?: string;
  text?: string;
  error?: string;
  total_cost?: number;
  total_tokens?: number;
  golden_prompt?: string;
  goldenPrompt?: string;
  topic?: string;
  mode?: string;
  id?: string;
  resolutions?: Array<{
    requested_model: string;
    effective_provider: string;
    effective_model: string;
    fallback_reason?: string;
  }>;
  [k: string]: unknown;
};

interface AgentCard {
  name: string;
  status: "thinking" | "done" | "errored";
  content: string;
  startTime: number;
  durationMs?: number;
}

const state = {
  topic: "",
  mode: "",
  agents: new Map<string, AgentCard>(),
  consensus: "",
  totalCost: undefined as number | undefined,
  totalTokens: undefined as number | undefined,
  status: "",
};

const els = {
  empty: document.getElementById("empty-state")!,
  debate: document.getElementById("debate")!,
  topic: document.getElementById("topic")!,
  meta: document.getElementById("meta")!,
  agents: document.getElementById("agents")!,
  synthesis: document.getElementById("synthesis")!,
  status: document.getElementById("status")!,
  cost: document.getElementById("cost")!,
};

function reset(): void {
  state.topic = "";
  state.mode = "";
  state.agents.clear();
  state.consensus = "";
  state.totalCost = undefined;
  state.totalTokens = undefined;
  state.status = "Starting…";
  render();
}

function render(): void {
  if (!state.topic) {
    els.empty.classList.remove("hidden");
    els.debate.classList.add("hidden");
    return;
  }
  els.empty.classList.add("hidden");
  els.debate.classList.remove("hidden");

  els.topic.textContent = state.topic;
  els.meta.textContent = state.mode ? `Mode: ${state.mode}` : "";

  els.agents.innerHTML = "";
  for (const card of state.agents.values()) {
    els.agents.appendChild(renderCard(card));
  }

  if (state.consensus) {
    els.synthesis.innerHTML = "";
    const h = document.createElement("h3");
    h.textContent = "Synthesis";
    const body = document.createElement("div");
    body.className = "synthesis-body";
    body.textContent = state.consensus;
    els.synthesis.appendChild(h);
    els.synthesis.appendChild(body);
  } else {
    els.synthesis.innerHTML = "";
  }

  els.status.textContent = state.status || "";
  if (state.totalCost === undefined && state.totalTokens === undefined) {
    els.cost.textContent = "";
    return;
  }
  const cost =
    state.totalCost === undefined ? "" : `$${state.totalCost.toFixed(4)}`;
  const tok =
    state.totalTokens === undefined
      ? ""
      : `${state.totalTokens.toLocaleString()} tokens`;
  els.cost.textContent = [cost, tok].filter(Boolean).join(" · ");
}

function dotForStatus(status: AgentCard["status"]): string {
  if (status === "done") return "✓";
  if (status === "errored") return "✗";
  return "·";
}

function renderCard(card: AgentCard): HTMLElement {
  const wrap = document.createElement("article");
  wrap.className = `agent-card agent-${card.status}`;

  const header = document.createElement("header");
  header.className = "agent-header";

  const dot = document.createElement("span");
  dot.className = "agent-dot";
  dot.textContent = dotForStatus(card.status);
  header.appendChild(dot);

  const name = document.createElement("span");
  name.className = "agent-name";
  name.textContent = card.name;
  header.appendChild(name);

  const duration = document.createElement("span");
  duration.className = "agent-duration";
  if (card.durationMs === undefined) {
    const elapsed = Math.floor((Date.now() - card.startTime) / 1000);
    duration.textContent = `${elapsed}s`;
  } else {
    duration.textContent = `${(card.durationMs / 1000).toFixed(1)}s`;
  }
  header.appendChild(duration);

  wrap.appendChild(header);

  const body = document.createElement("div");
  body.className = "agent-body";
  body.textContent =
    card.content || (card.status === "thinking" ? "thinking…" : "");
  wrap.appendChild(body);
  return wrap;
}

// Each handler updates `state` for one event type. Splitting them
// out keeps `handleEvent` itself flat (Sonar S3776 cognitive
// complexity).
const HANDLERS: Record<string, (event: DebateEvent) => void> = {
  debate_start(event) {
    state.topic = event.topic ?? state.topic ?? "(running…)";
    state.mode = event.mode ?? state.mode;
    state.status = "Council started";
  },
  debate_id() {
    // Optional. Could surface the id for the open-in-web button.
  },
  agent_start(event) {
    const name = event.agent ?? "agent";
    state.agents.set(name, {
      name,
      status: "thinking",
      content: "",
      startTime: Date.now(),
    });
    state.status = `${name} thinking…`;
  },
  agent_chunk(event) {
    const name = event.agent ?? Array.from(state.agents.keys()).pop() ?? "";
    const card = state.agents.get(name);
    if (card && event.text) card.content += event.text;
  },
  agent_complete(event) {
    const name = event.agent ?? Array.from(state.agents.keys()).pop() ?? "";
    const card = state.agents.get(name);
    if (card) {
      card.status = "done";
      card.durationMs = Date.now() - card.startTime;
    }
    state.status = `${name} finished`;
  },
  consensus(event) {
    if (event.text) state.consensus = event.text;
  },
  done(event) {
    state.status = "Done";
    if (event.total_cost !== undefined) state.totalCost = event.total_cost;
    if (event.total_tokens !== undefined)
      state.totalTokens = event.total_tokens;
    const golden = event.golden_prompt ?? event.goldenPrompt;
    if (golden && !state.consensus) state.consensus = golden;
  },
  cancelled() {
    state.status = "Cancelled";
  },
  error(event) {
    state.status = `Error: ${event.error ?? "unknown"}`;
  },
  "routing:fallback"(event) {
    state.status = `Routing ${event.resolutions?.length ?? 0} model(s) to free tier`;
  },
  "tool:call_request"(event) {
    const name = typeof event.name === "string" ? event.name : "(unknown)";
    state.status = `Tool requested: ${name}`;
  },
};

function handleEvent(event: DebateEvent): void {
  const type = event.type ?? event.event;
  const handler = type ? HANDLERS[type] : undefined;
  if (handler) {
    handler(event);
  } else if (typeof type === "string") {
    // Unknown event types are surfaced as status hints.
    state.status = type.replaceAll("_", " ");
  }
  render();
}

// VS Code webview origin allowlist. The extension host delivers
// postMessage events via the webview's own `vscode-webview://...`
// origin (matches `globalThis.location.origin`); any other origin is
// a cross-document message we do not trust and must reject (S2819).
const WEBVIEW_ORIGIN = globalThis.location.origin;

globalThis.addEventListener("message", (msg) => {
  if (msg.origin !== WEBVIEW_ORIGIN) return;
  const data = msg.data as { type?: string; event?: DebateEvent };
  if (!data || typeof data !== "object") return;
  if (data.type === "reset") {
    reset();
  } else if (data.type === "event" && data.event) {
    handleEvent(data.event);
  }
});

// Tick once per second so duration counters stay live while the
// stream isn't sending events.
setInterval(() => {
  if (state.agents.size > 0) render();
}, 1000);

vscode.postMessage({ type: "ready" });
render();
