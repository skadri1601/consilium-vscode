/**
 * Streaming HTTP client for the Consilium API. Lifted from
 * packages/cli/src/api/client.ts and pared down to the surface the
 * extension actually uses (createDebate / streamDebate / cancel /
 * postToolResult / listDebates). Once the public @myconsilium/sdk
 * gains streaming methods, this file should be replaced with a thin
 * adapter over the SDK.
 *
 * Uses Node 18+'s built-in fetch + ReadableStream.
 */

import * as vscode from "vscode";

export type DebateMode =
  | "auto"
  | "quick"
  | "council"
  | "deep"
  | "blind"
  | "redteam"
  | "jury"
  | "market";

export interface DebateOptions {
  topic: string;
  mode?: DebateMode;
  models?: string[];
  debateSource?: string;
  files?: Array<{ name: string; content: string }>;
  projectContext?: Record<string, unknown>;
  tools?: Array<{
    qualifiedName: string;
    description?: string;
    inputSchema?: unknown;
  }>;
  toolBudget?: {
    maxCallsPerTurn?: number;
    maxTotalCalls?: number;
    perCallTimeoutMs?: number;
  };
}

export interface DebateEvent {
  type:
    | "debate_start"
    | "agent_start"
    | "agent_chunk"
    | "agent_complete"
    | "consensus"
    | "done"
    | "error"
    | "tool:call_request"
    | "tool:call_completed"
    | "tool:call_failed"
    | "routing:fallback";
  agent?: string;
  text?: string;
  error?: string;
  total_cost?: number;
  total_tokens?: number;
  golden_prompt?: string;
  goldenPrompt?: string;
  callId?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  resolutions?: Array<{
    requested_model: string;
    effective_provider: string;
    effective_model: string;
    fallback_reason?: string;
  }>;
  [key: string]: unknown;
}

export interface DebateSummary {
  id: string;
  topic?: string;
  mode?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class ConsiliumApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly getToken: () => Promise<string | undefined>,
  ) {}

  private async headers(
    extra: Record<string, string> = {},
  ): Promise<Record<string, string>> {
    const token = await this.getToken();
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extra,
    };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  async createDebate(options: DebateOptions): Promise<{ id: string }> {
    const res = await fetch(`${this.apiUrl}/api/v1/debates`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        topic: options.topic,
        mode: options.mode ?? "auto",
        models: options.models ?? [],
        debateSource: options.debateSource ?? "vscode",
        ...(options.files ? { files: options.files } : {}),
        ...(options.projectContext
          ? { projectContext: options.projectContext }
          : {}),
        ...(options.tools?.length ? { tools: options.tools } : {}),
        ...(options.toolBudget ? { toolBudget: options.toolBudget } : {}),
      }),
    });
    if (!res.ok) throw await asError(res, "createDebate");
    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error("createDebate: no id in response");
    return { id: data.id };
  }

  async cancelDebate(debateId: string): Promise<void> {
    const res = await fetch(
      `${this.apiUrl}/api/v1/debates/${debateId}/cancel`,
      {
        method: "POST",
        headers: await this.headers(),
      },
    );
    if (!res.ok && res.status !== 404) throw await asError(res, "cancelDebate");
  }

  async listDebates(
    opts: { limit?: number; search?: string } = {},
  ): Promise<DebateSummary[]> {
    const url = new URL(`${this.apiUrl}/api/v1/debates`);
    if (opts.limit) url.searchParams.set("limit", String(opts.limit));
    if (opts.search) url.searchParams.set("search", opts.search);
    const res = await fetch(url.toString(), {
      headers: await this.headers(),
    });
    if (!res.ok) throw await asError(res, "listDebates");
    const body = (await res.json()) as
      | DebateSummary[]
      | { items?: DebateSummary[] };
    return Array.isArray(body) ? body : (body.items ?? []);
  }

  async postToolResult(
    debateId: string,
    callId: string,
    result: {
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    },
  ): Promise<void> {
    const res = await fetch(
      `${this.apiUrl}/api/v1/deliberation/${debateId}/tool-results`,
      {
        method: "POST",
        headers: await this.headers(),
        body: JSON.stringify({ callId, result }),
      },
    );
    if (!res.ok && res.status !== 404)
      throw await asError(res, "postToolResult");
  }

  /**
   * Stream debate events. Yields one DebateEvent per SSE frame and
   * resolves when the stream closes naturally (done event or HTTP end).
   * Throws on transport / parse errors so the caller can surface
   * them in the webview status bar.
   */
  async *streamDebate(
    debateId: string,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<DebateEvent, void, void> {
    const res = await fetch(
      `${this.apiUrl}/api/v1/debates/${debateId}/stream`,
      {
        headers: await this.headers({ Accept: "text/event-stream" }),
        signal: abortSignal,
      },
    );
    if (!res.ok || !res.body) throw await asError(res, "streamDebate");
    yield* parseSseStream(res.body);
  }
}

interface SseFrame {
  event: DebateEvent;
  isDone: boolean;
}

function parseSseLine(
  line: string,
  currentEvent: string | null,
): {
  nextEvent: string | null;
  frame?: SseFrame;
} {
  if (line.startsWith("event: ")) {
    return { nextEvent: line.slice(7).trim() };
  }
  if (!line.startsWith("data: ")) {
    // Blank line resets the current event name; everything else (e.g.
    // SSE comments starting with ":") is ignored.
    return { nextEvent: line.trim() === "" ? null : currentEvent };
  }
  const parsed = parseSseDataLine(line.slice(6), currentEvent);
  const isDone = parsed.type === "done" || currentEvent === "done";
  return { nextEvent: null, frame: { event: parsed, isDone } };
}

function parseSseDataLine(
  dataStr: string,
  currentEvent: string | null,
): DebateEvent {
  let parsed: DebateEvent;
  try {
    parsed = JSON.parse(dataStr) as DebateEvent;
  } catch {
    parsed = { type: "agent_chunk", text: dataStr } as DebateEvent;
  }
  if (currentEvent && !parsed.type) {
    parsed.type = currentEvent as DebateEvent["type"];
  }
  if (currentEvent) parsed.event = currentEvent;
  return parsed;
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<DebateEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentEvent: string | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const result = parseSseLine(line, currentEvent);
      currentEvent = result.nextEvent;
      if (result.frame) {
        yield result.frame.event;
        if (result.frame.isDone) return;
      }
    }
  }
}

async function asError(res: Response, op: string): Promise<Error> {
  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) {
    return new Error(
      `${op}: not authorized (${res.status}). Run "Consilium: Sign in" to refresh your token.`,
    );
  }
  if (res.status === 429) {
    return new Error(`${op}: rate limited (429). Try again shortly.`);
  }
  const detail = text ? `: ${text.slice(0, 200)}` : "";
  return new Error(`${op}: HTTP ${res.status}${detail}`);
}

export function getApiClient(
  ctx: vscode.ExtensionContext,
  getToken: () => Promise<string | undefined>,
): ConsiliumApiClient {
  const cfg = vscode.workspace.getConfiguration("consilium");
  const apiUrl = cfg.get<string>("apiUrl") ?? "https://api.myconsilium.xyz";
  return new ConsiliumApiClient(apiUrl.replace(/\/$/, ""), getToken);
}
