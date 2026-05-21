import * as vscode from "vscode";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
  ConsiliumApiClient,
  DebateMode,
  DebateOptions,
} from "../api-client";
import type { DebatePanelProvider } from "../views/debate-panel";

const exec = promisify(cp.execFile);

interface RunDebateInput {
  topic: string;
  /** Optional projectContext fragments to merge into the API payload. */
  context?: Record<string, unknown>;
  /** Optional file attachments. */
  files?: Array<{ name: string; content: string }>;
  /** Force a specific mode; falls back to consilium.defaultMode. */
  mode?: DebateMode;
}

export async function runDebate(
  input: RunDebateInput,
  client: ConsiliumApiClient,
  panel: DebatePanelProvider,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("consilium");
  const toolsEnabled = cfg.get<boolean>("toolsEnabled") ?? true;
  const opts = await buildDebateOptions(input, cfg, toolsEnabled);

  panel.reset();
  panel.reveal();
  panel.postEvent({
    type: "debate_start",
    topic: input.topic,
    mode: opts.mode,
  });

  const debate = await tryCreateDebate(client, panel, opts);
  if (!debate) return;

  panel.postEvent({ type: "debate_id", id: debate.id });

  const ac = new AbortController();
  const cancelDisposable = registerCancelButton(() => ac.abort());

  try {
    await streamAndDispatch(client, panel, debate.id, ac, toolsEnabled);
  } finally {
    cancelDisposable.dispose();
  }
}

async function buildDebateOptions(
  input: RunDebateInput,
  cfg: vscode.WorkspaceConfiguration,
  toolsEnabled: boolean,
): Promise<DebateOptions> {
  const mode =
    input.mode ??
    (cfg.get<string>("defaultMode") as DebateMode | undefined) ??
    "auto";
  const models = cfg.get<string[]>("defaultModels") ?? [];
  const autoGit = cfg.get<boolean>("autoAttachGitContext") ?? true;

  const projectContext: Record<string, unknown> = input.context
    ? { ...input.context }
    : {};
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    projectContext.rootPath = wsFolder.uri.fsPath;
    projectContext.cwd = wsFolder.uri.fsPath;
    if (autoGit && fs.existsSync(path.join(wsFolder.uri.fsPath, ".git"))) {
      const git = await collectGitContext(wsFolder.uri.fsPath);
      if (git) projectContext.git = git;
    }
  }

  const opts: DebateOptions = {
    topic: input.topic,
    mode,
    models,
    debateSource: "vscode",
    files: input.files,
    projectContext,
  };
  if (toolsEnabled) {
    opts.tools = BUILTIN_TOOL_SCHEMAS;
    opts.toolBudget = {
      maxCallsPerTurn: 5,
      maxTotalCalls: 50,
      perCallTimeoutMs: 30000,
    };
  }
  return opts;
}

async function tryCreateDebate(
  client: ConsiliumApiClient,
  panel: DebatePanelProvider,
  opts: DebateOptions,
): Promise<{ id: string } | null> {
  try {
    return await client.createDebate(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    panel.postEvent({ type: "error", error: msg });
    vscode.window.showErrorMessage(`Consilium: ${msg}`);
    return null;
  }
}

async function streamAndDispatch(
  client: ConsiliumApiClient,
  panel: DebatePanelProvider,
  debateId: string,
  ac: AbortController,
  toolsEnabled: boolean,
): Promise<void> {
  try {
    for await (const event of client.streamDebate(debateId, ac.signal)) {
      panel.postEvent(event);
      if (toolsEnabled && event.type === "tool:call_request") {
        await respondNotImplemented(client, debateId, event.callId);
      }
    }
  } catch (err) {
    await handleStreamError(client, panel, debateId, ac, err);
  }
}

async function respondNotImplemented(
  client: ConsiliumApiClient,
  debateId: string,
  callId: string | undefined,
): Promise<void> {
  // Tool execution is intentionally NOT auto-run from the extension
  // host yet. Surface the request to the panel so the user sees it,
  // and post a stub result so the model continues without hanging.
  // Wiring full local tool execution is a follow-up (see PR body).
  await client.postToolResult(debateId, callId ?? "", {
    content: [
      {
        type: "text",
        text: "Tool execution from VS Code extension is gated to a follow-up release. Use the CLI for tool-enabled debates today.",
      },
    ],
    isError: true,
  });
}

async function handleStreamError(
  client: ConsiliumApiClient,
  panel: DebatePanelProvider,
  debateId: string,
  ac: AbortController,
  err: unknown,
): Promise<void> {
  if (ac.signal.aborted) {
    panel.postEvent({ type: "cancelled" });
    try {
      await client.cancelDebate(debateId);
    } catch {
      /* ignore */
    }
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  panel.postEvent({ type: "error", error: msg });
  vscode.window.showErrorMessage(`Consilium: ${msg}`);
}

function registerCancelButton(onCancel: () => void): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.text = "$(stop-circle) Cancel debate";
  item.tooltip = "Stop the running Consilium debate";
  item.command = "consilium.cancelRunningDebate";
  const disp = vscode.commands.registerCommand(
    "consilium.cancelRunningDebate",
    () => {
      onCancel();
      item.hide();
    },
  );
  item.show();
  return new vscode.Disposable(() => {
    item.dispose();
    disp.dispose();
  });
}

async function collectGitContext(
  cwd: string,
): Promise<{ branch?: string; diff?: string; recent?: string } | null> {
  try {
    const branch = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      timeout: 5000,
    });
    const diff = await exec("git", ["diff"], {
      cwd,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const recent = await exec("git", ["log", "--oneline", "-10"], {
      cwd,
      timeout: 5000,
    });
    return {
      branch: branch.stdout.trim(),
      diff: diff.stdout.slice(0, 50_000),
      recent: recent.stdout.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Schemas mirror the CLI's built-in tool suite. Advertising them
 * doesn't run them - execution is the next milestone (Step 4 in the
 * PR's roadmap). For now, the council sees the schemas + can ask;
 * the extension responds with a "use the CLI for now" tool result so
 * the model continues without hanging on a missing answer.
 */
const BUILTIN_TOOL_SCHEMAS = [
  {
    qualifiedName: "consilium__read",
    description:
      "Read a project file. Returns text with line numbers (1-indexed).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer" },
        limit: { type: "integer" },
      },
      required: ["path"],
    },
  },
  {
    qualifiedName: "consilium__grep",
    description: "Search file contents (regex). Returns up to 200 matches.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        glob: { type: "string" },
        ignore_case: { type: "boolean" },
      },
      required: ["pattern"],
    },
  },
  {
    qualifiedName: "consilium__glob",
    description: "Find files by glob pattern.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
];
