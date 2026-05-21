import * as vscode from "vscode";
import { AuthManager } from "./auth";
import { getApiClient } from "./api-client";
import { DebatePanelProvider } from "./views/debate-panel";
import { HistoryViewProvider } from "./views/history-view";
import {
  applyEditsCommand,
  debateCommand,
  debateFailingCommand,
  debateFileCommand,
  debateSelectionCommand,
  debateStagedCommand,
  openDebateCommand,
  openHistoryCommand,
} from "./commands/all";

export function activate(context: vscode.ExtensionContext): void {
  const auth = new AuthManager(context);
  const client = getApiClient(context, () => auth.getToken());
  const panel = new DebatePanelProvider(context);
  const history = new HistoryViewProvider(client);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DebatePanelProvider.viewId,
      panel,
    ),
    vscode.window.registerTreeDataProvider("consilium.history", history),
  );

  // Wrap each command in an auth gate so the user gets a single,
  // clear "sign in" prompt instead of N consecutive 401s.
  const guarded =
    (
      fn: (
        client: ReturnType<typeof getApiClient>,
        panel: DebatePanelProvider,
      ) => Promise<void>,
    ) =>
    async (): Promise<void> => {
      const token = await auth.ensureToken();
      if (!token) {
        vscode.window.showWarningMessage(
          "Consilium: sign in to start a debate.",
        );
        return;
      }
      try {
        await fn(client, panel);
        history.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Consilium: ${msg}`);
      }
    };

  context.subscriptions.push(
    vscode.commands.registerCommand("consilium.debate", guarded(debateCommand)),
    vscode.commands.registerCommand(
      "consilium.debateSelection",
      guarded(debateSelectionCommand),
    ),
    vscode.commands.registerCommand(
      "consilium.debateFile",
      guarded(debateFileCommand),
    ),
    vscode.commands.registerCommand(
      "consilium.debateStaged",
      guarded(debateStagedCommand),
    ),
    vscode.commands.registerCommand(
      "consilium.debateFailing",
      guarded(debateFailingCommand),
    ),
    vscode.commands.registerCommand("consilium.applyEdits", applyEditsCommand),
    vscode.commands.registerCommand(
      "consilium.openHistory",
      openHistoryCommand,
    ),
    vscode.commands.registerCommand("consilium.openDebate", openDebateCommand),
    vscode.commands.registerCommand("consilium.signIn", async () => {
      await auth.signInFlow();
    }),
    vscode.commands.registerCommand("consilium.signOut", async () => {
      await auth.clearToken();
      vscode.window.showInformationMessage("Consilium: signed out.");
    }),
  );

  // Status bar entry - quick way to start a debate without hunting
  // through the command palette.
  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );
  statusItem.text = "$(comment-discussion) Consilium";
  statusItem.tooltip = "Run a Consilium debate";
  statusItem.command = "consilium.debate";
  statusItem.show();
  context.subscriptions.push(statusItem);
}

export function deactivate(): void {
  // Nothing to clean up explicitly - disposables registered on
  // context.subscriptions are released by VS Code automatically.
}
