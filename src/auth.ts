import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Auth strategy:
 *   1. VS Code SecretStorage (preferred - encrypted at rest by VS Code)
 *   2. ~/.consilium/config.json (cross-tool SSO with the CLI)
 *   3. Browser sign-in flow → store the resulting token in SecretStorage
 *
 * The CLI fallback is the magic bit: a developer who already ran
 * `consilium login` from their terminal gets the extension auth-ed for
 * free, without typing a token into VS Code.
 */

const SECRET_KEY = "consilium.apiKey";
const CLI_CONFIG_PATH = path.join(os.homedir(), ".consilium", "config.json");

interface CliConfig {
  apiKey?: string;
  apiUrl?: string;
  webUrl?: string;
  userName?: string;
}

function readCliConfig(): CliConfig | null {
  try {
    if (!fs.existsSync(CLI_CONFIG_PATH)) return null;
    const raw = fs.readFileSync(CLI_CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as CliConfig;
  } catch {
    return null;
  }
}

export class AuthManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async getToken(): Promise<string | undefined> {
    const stored = await this.context.secrets.get(SECRET_KEY);
    if (stored) return stored;
    const cliCfg = readCliConfig();
    if (cliCfg?.apiKey) {
      // Migrate the CLI token into SecretStorage so subsequent reads
      // don't re-touch disk and so the user can revoke independently.
      await this.context.secrets.store(SECRET_KEY, cliCfg.apiKey);
      return cliCfg.apiKey;
    }
    return undefined;
  }

  async setToken(token: string): Promise<void> {
    await this.context.secrets.store(SECRET_KEY, token);
  }

  async clearToken(): Promise<void> {
    await this.context.secrets.delete(SECRET_KEY);
  }

  /**
   * Open the browser sign-in flow and prompt for the token returned.
   * The CLI uses a similar flow (login.ts) - eventually this should
   * use a deeplink + URI handler for a fully automated round-trip.
   */
  async signInFlow(): Promise<string | undefined> {
    const cfg = vscode.workspace.getConfiguration("consilium");
    const apiUrl = cfg.get<string>("apiUrl") ?? "https://api.myconsilium.xyz";
    const webOrigin = apiUrl
      .replace(/\/api\/?$/, "")
      .replace(/api\.(.+)/, "$1");
    const webUrl = webOrigin.startsWith("http")
      ? webOrigin
      : "https://myconsilium.xyz";
    await vscode.env.openExternal(
      vscode.Uri.parse(`${webUrl}/cli/auth?source=vscode-extension`),
    );
    const token = await vscode.window.showInputBox({
      title: "Consilium API token",
      prompt:
        "Paste the CLI token from the page that just opened. (Stored encrypted in VS Code SecretStorage.)",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value && value.trim().length > 8 ? null : "Token looks too short.",
    });
    if (!token) return undefined;
    await this.setToken(token.trim());
    vscode.window.showInformationMessage("Consilium: signed in.");
    return token.trim();
  }

  async ensureToken(): Promise<string | undefined> {
    const existing = await this.getToken();
    if (existing) return existing;
    const choice = await vscode.window.showInformationMessage(
      "Consilium needs an API token to start a debate.",
      "Sign in",
      "Paste token",
    );
    if (choice === "Sign in") {
      return this.signInFlow();
    }
    if (choice === "Paste token") {
      const token = await vscode.window.showInputBox({
        title: "Consilium API token",
        password: true,
        ignoreFocusOut: true,
      });
      if (!token) return undefined;
      await this.setToken(token.trim());
      return token.trim();
    }
    return undefined;
  }
}
