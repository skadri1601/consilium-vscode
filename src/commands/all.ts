import * as vscode from "vscode";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ConsiliumApiClient } from "../api-client";
import type { DebatePanelProvider } from "../views/debate-panel";
import { runDebate } from "./run-debate";

const exec = promisify(cp.execFile);

export async function debateCommand(
  client: ConsiliumApiClient,
  panel: DebatePanelProvider,
): Promise<void> {
  const topic = await vscode.window.showInputBox({
    title: "Consilium: Debate a topic",
    prompt: "What should the council debate?",
    ignoreFocusOut: true,
  });
  if (!topic?.trim()) return;
  await runDebate({ topic: topic.trim() }, client, panel);
}

export async function debateSelectionCommand(
  client: ConsiliumApiClient,
  panel: DebatePanelProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage("Consilium: select code first.");
    return;
  }
  const selection = editor.document.getText(editor.selection);
  const filename = path.basename(editor.document.fileName);
  const lang = editor.document.languageId;
  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;

  const question = await vscode.window.showInputBox({
    title: "Consilium: Debate selected code",
    prompt: "What should the council weigh in on?",
    placeHolder:
      "e.g. 'review for correctness', 'is this thread-safe?', 'simplify if possible'",
    ignoreFocusOut: true,
  });
  if (!question?.trim()) return;

  const topic = [
    `# ${question.trim()}`,
    "",
    `**File:** ${filename} · **Lines ${startLine}–${endLine}** · ${lang}`,
    "",
    "```" + lang,
    selection,
    "```",
    "",
    "---",
    "",
    "Council: focus the debate on the snippet above. Recommend specific changes with file paths and line numbers.",
  ].join("\n");

  await runDebate(
    {
      topic,
      files: [{ name: filename, content: selection.slice(0, 32000) }],
      context: {
        selection: { file: filename, startLine, endLine, language: lang },
      },
    },
    client,
    panel,
  );
}

export async function debateFileCommand(
  client: ConsiliumApiClient,
  panel: DebatePanelProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Consilium: open a file first.");
    return;
  }
  const filename = path.basename(editor.document.fileName);
  const lang = editor.document.languageId;
  const content = editor.document.getText().slice(0, 60000);
  const truncated =
    editor.document.getText().length > 60000 ? "\n...[truncated]" : "";

  const question = await vscode.window.showInputBox({
    title: "Consilium: Debate this file",
    prompt: "What's the question?",
    placeHolder:
      "e.g. 'review the architecture', 'find bugs', 'how to test this'",
    ignoreFocusOut: true,
  });
  if (!question?.trim()) return;

  const topic = [
    `# ${question.trim()}`,
    "",
    `**File:** ${filename} · ${lang}`,
    "",
    "```" + lang,
    content + truncated,
    "```",
  ].join("\n");

  await runDebate(
    {
      topic,
      files: [{ name: filename, content: content + truncated }],
      context: { file: { name: filename, language: lang } },
    },
    client,
    panel,
  );
}

export async function debateStagedCommand(
  client: ConsiliumApiClient,
  panel: DebatePanelProvider,
): Promise<void> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws || !fs.existsSync(path.join(ws.uri.fsPath, ".git"))) {
    vscode.window.showWarningMessage("Consilium: not a git repository.");
    return;
  }
  const cwd = ws.uri.fsPath;
  const staged = await exec("git", ["diff", "--staged"], {
    cwd,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10_000,
  }).catch(() => null);
  if (!staged?.stdout?.trim()) {
    vscode.window.showWarningMessage(
      "Consilium: nothing staged. Run `git add` first.",
    );
    return;
  }
  const stat = await exec("git", ["diff", "--staged", "--stat"], {
    cwd,
    timeout: 5_000,
  }).catch(() => ({ stdout: "" }));
  const branch = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    timeout: 5_000,
  }).catch(() => ({ stdout: "unknown" }));

  const diff = staged.stdout.slice(0, 50_000);
  const truncated = staged.stdout.length > 50_000 ? "\n...[truncated]" : "";

  const topic = [
    `# Staged changes review (${branch.stdout.trim()})`,
    "",
    "## Stat",
    "```",
    stat.stdout.trim(),
    "```",
    "",
    "## Diff",
    "```diff",
    diff + truncated,
    "```",
    "",
    "---",
    "",
    "Council: review this diff before commit. Identify correctness issues, missed edge cases, name/style inconsistency, security concerns, missing tests. Recommend whether to commit, amend, or rework.",
  ].join("\n");

  await runDebate({ topic, mode: "council" }, client, panel);
}

export async function debateFailingCommand(
  client: ConsiliumApiClient,
  panel: DebatePanelProvider,
): Promise<void> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) {
    vscode.window.showWarningMessage("Consilium: open a workspace first.");
    return;
  }
  const cfg = vscode.workspace.getConfiguration("consilium");
  const override = cfg.get<string>("testCommand");

  let cmd: { exe: string; args: string[] };
  if (override?.trim()) {
    const parts = override.trim().split(/\s+/);
    cmd = { exe: parts[0]!, args: parts.slice(1) };
  } else {
    const detected = await detectTestCommand(ws.uri.fsPath);
    if (!detected) {
      vscode.window.showErrorMessage(
        "Consilium: could not detect a test runner. Set `consilium.testCommand` in settings.",
      );
      return;
    }
    cmd = detected;
  }

  vscode.window.setStatusBarMessage(
    `$(beaker) Running ${cmd.exe} ${cmd.args.join(" ")}`,
    5000,
  );
  const result = await exec(cmd.exe, cmd.args, {
    cwd: ws.uri.fsPath,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  }).catch(
    (err: {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    }) => ({
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? "",
      exitCode: typeof err.code === "number" ? err.code : 1,
    }),
  );

  const exitCode = "exitCode" in result ? result.exitCode : 0;
  if (exitCode === 0) {
    vscode.window.showInformationMessage(
      "Consilium: all tests pass - nothing to debate.",
    );
    return;
  }

  const output = (result.stdout + "\n" + (result.stderr ?? "")).slice(
    0,
    32_000,
  );
  const topic = [
    `# Failing test run: ${cmd.exe} ${cmd.args.join(" ")}`,
    "",
    `Exit code: ${exitCode}`,
    "",
    "## Output",
    "```",
    output,
    "```",
    "",
    "---",
    "",
    "Council: identify the root cause (not just the surface symptom). Recommend a fix with specific file paths and exact code changes.",
  ].join("\n");

  await runDebate({ topic, mode: "council" }, client, panel);
}

async function detectTestCommand(
  cwd: string,
): Promise<{ exe: string; args: string[] } | null> {
  const has = (rel: string) => fs.existsSync(path.join(cwd, rel));
  if (has("pnpm-lock.yaml") && has("package.json")) {
    return { exe: "pnpm", args: ["test"] };
  }
  if (has("package-lock.json") && has("package.json")) {
    return { exe: "npm", args: ["test"] };
  }
  if (has("yarn.lock") && has("package.json")) {
    return { exe: "yarn", args: ["test"] };
  }
  if (
    has("pyproject.toml") ||
    has("pytest.ini") ||
    has("tests") ||
    has("conftest.py")
  ) {
    return { exe: "pytest", args: ["-x", "--tb=short"] };
  }
  if (has("Cargo.toml")) return { exe: "cargo", args: ["test"] };
  if (has("go.mod")) return { exe: "go", args: ["test", "./..."] };
  return null;
}

export async function applyEditsCommand(): Promise<void> {
  vscode.window.showInformationMessage(
    "Consilium: structured edit application via the extension is staged for the next release. Use `consilium /apply` from the integrated terminal in the meantime.",
  );
}

export async function openHistoryCommand(): Promise<void> {
  await vscode.commands.executeCommand("consilium.history.focus");
}

export async function openDebateCommand(debateId: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("consilium");
  const apiUrl = cfg.get<string>("apiUrl") ?? "https://api.myconsilium.xyz";
  const webUrl = apiUrl.replace(/\/api\/?$/, "").replace(/api\.(.+)/, "$1");
  await vscode.env.openExternal(
    vscode.Uri.parse(`${webUrl}/debates/${debateId}`),
  );
}
