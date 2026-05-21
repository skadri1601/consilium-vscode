import * as vscode from "vscode";
import type { ConsiliumApiClient, DebateSummary } from "../api-client";

function iconForStatus(status: string | undefined): string {
  if (status === "completed") return "check";
  if (status === "failed") return "error";
  if (status === "processing") return "loading~spin";
  return "comment-discussion";
}

function labelFor(topic: string | undefined): string {
  const raw = topic ?? "(no topic)";
  const truncated = topic && topic.length > 80 ? "…" : "";
  return raw.slice(0, 80) + truncated;
}

class DebateNode extends vscode.TreeItem {
  constructor(public readonly summary: DebateSummary) {
    super(labelFor(summary.topic), vscode.TreeItemCollapsibleState.None);
    this.id = summary.id;
    this.description = `${summary.mode ?? "?"} · ${summary.status ?? "?"}`;
    this.tooltip = `${summary.topic ?? ""}\n${summary.id}\n${summary.createdAt ?? ""}`;
    this.iconPath = new vscode.ThemeIcon(iconForStatus(summary.status));
    this.contextValue = "consilium.debate";
    this.command = {
      command: "consilium.openDebate",
      title: "Open debate",
      arguments: [summary.id],
    };
  }
}

export class HistoryViewProvider implements vscode.TreeDataProvider<DebateNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    DebateNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cache: DebateSummary[] = [];

  constructor(private readonly client: ConsiliumApiClient) {}

  refresh(): void {
    void this.load();
  }

  getTreeItem(element: DebateNode): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<DebateNode[]> {
    if (this.cache.length === 0) await this.load();
    return this.cache.map((s) => new DebateNode(s));
  }

  private async load(): Promise<void> {
    try {
      this.cache = await this.client.listDebates({ limit: 50 });
      this._onDidChangeTreeData.fire();
    } catch (err) {
      this.cache = [];
      this._onDidChangeTreeData.fire();
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Consilium history: ${msg}`);
    }
  }
}
