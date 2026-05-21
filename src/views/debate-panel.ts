import * as vscode from "vscode";
import * as crypto from "node:crypto";

/**
 * Webview view rendered in the Consilium activity-bar container. Hosts
 * a vanilla-JS UI (dist/webview/debate.js) and message-passes events
 * from the extension host into the webview as the SSE stream lands.
 */
export class DebatePanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "consilium.debatePanel";

  private view?: vscode.WebviewView;
  private pendingEvents: unknown[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;
      const m = msg as { type: string };
      if (m.type === "ready") {
        // Replay any events buffered before the webview attached.
        for (const ev of this.pendingEvents) {
          ignore(webviewView.webview.postMessage({ type: "event", event: ev }));
        }
        this.pendingEvents = [];
      }
      if (m.type === "command" && "command" in msg) {
        ignore(
          vscode.commands.executeCommand(
            (msg as { command: string }).command,
            ...((msg as { args?: unknown[] }).args ?? []),
          ),
        );
      }
    });
  }

  postEvent(event: unknown): void {
    if (this.view) {
      ignore(this.view.webview.postMessage({ type: "event", event }));
    } else {
      this.pendingEvents.push(event);
    }
  }

  reset(): void {
    if (this.view) {
      ignore(this.view.webview.postMessage({ type: "reset" }));
    }
    this.pendingEvents = [];
  }

  reveal(): void {
    if (this.view) {
      this.view.show(true);
    } else {
      ignore(vscode.commands.executeCommand("consilium.debatePanel.focus"));
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "dist",
        "webview",
        "debate.js",
      ),
    );
    const nonce = makeNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
  <title>Consilium Council</title>
</head>
<body>
  <div id="app">
    <div id="empty-state" class="empty">
      <h2>Consilium Council</h2>
      <p>Run a debate to see the council in action.</p>
      <ul class="hint-list">
        <li><code>Consilium: Debate selected code</code> - right-click a selection</li>
        <li><code>Consilium: Debate this file</code> - right-click anywhere in the editor</li>
        <li><code>Consilium: Review staged changes</code> - pre-commit review</li>
        <li><code>Consilium: Debate the failing test output</code> - auto-run + debate</li>
      </ul>
    </div>
    <div id="debate" class="debate hidden">
      <header class="debate-header">
        <div class="debate-topic" id="topic"></div>
        <div class="debate-meta" id="meta"></div>
      </header>
      <section class="agents" id="agents"></section>
      <section class="synthesis" id="synthesis"></section>
      <footer class="debate-footer">
        <span id="status">Ready.</span>
        <span id="cost"></span>
      </footer>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// Fire-and-forget helper for thenables we intentionally don't await.
// The `void` operator triggers Sonar S3735 in this codebase; this
// keeps the intent explicit without that warning.
function ignore<T>(_promise: Thenable<T>): void {
  /* intentionally not awaited */
}

function makeNonce(): string {
  // CSP nonces must be cryptographically unpredictable - Math.random
  // is a PRNG that can be modeled, which would let an attacker who
  // controls any injected content guess the nonce and bypass the CSP.
  // randomBytes(16) gives 128 bits of entropy; base64url keeps the
  // value in the CSP-safe character set.
  return crypto.randomBytes(16).toString("base64url");
}
