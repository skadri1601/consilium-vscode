# Consilium - Multi-AI Council

Run multi-AI debates across **OpenAI, Anthropic, Google, Groq, xAI, Moonshot, and OpenRouter** - directly inside VS Code or Cursor.

Right-click code, ask a question, watch seven providers argue it out in a live panel. Get a synthesized answer that survived adversarial scrutiny.

## What you get

- **Right-click → "Debate selected code"** - council reviews the snippet
- **"Debate this file"** - full-file review, architecture, edge cases
- **"Review staged changes"** - pre-commit council review of `git diff --staged`
- **"Debate the failing test output"** - auto-runs your test command, debates the failure
- **Live debate panel** - agent cards with per-model progress, convergence, dissent, and synthesis
- **Debate history** in the activity bar - jump into any past debate
- **Status bar entry** for one-click debate from anywhere in the editor

## Install

### From VS Code Marketplace

Search for "Consilium" or:

```
Ctrl/Cmd-P → ext install myconsilium.consilium-vscode
```

### From OpenVSX (Cursor / Codium)

The extension is published to OpenVSX and auto-imported by Cursor. Search for "Consilium" in the extensions sidebar.

## Sign in

```
Cmd/Ctrl-Shift-P → Consilium: Sign in
```

The extension auto-detects an existing CLI token at `~/.consilium/config.json` (cross-tool single sign-on with the Consilium CLI). Otherwise it opens a browser tab to grant a token.

## Configuration

| Setting                          | Default                       | What it does                                                             |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `consilium.apiUrl`               | `https://api.myconsilium.xyz` | API base URL - override for self-hosted or local                         |
| `consilium.defaultMode`          | `auto`                        | One of `auto / quick / council / deep / blind / redteam / jury / market` |
| `consilium.defaultModels`        | `[]`                          | Override council model list. Empty = engine picks.                       |
| `consilium.toolsEnabled`         | `true`                        | Advertise built-in Read/Grep/Glob tool schemas to the council            |
| `consilium.autoAttachGitContext` | `true`                        | Auto-attach branch + uncommitted diff + recent commits to every debate   |
| `consilium.testCommand`          | `""`                          | Override auto-detect for "Debate the failing test output"                |

## Commands

- `Consilium: Debate a topic`
- `Consilium: Debate selected code`
- `Consilium: Debate this file`
- `Consilium: Review staged changes` (also in the SCM title bar)
- `Consilium: Debate the failing test output`
- `Consilium: Apply edits from latest synthesis`
- `Consilium: Open debate history`
- `Consilium: Sign in` / `Consilium: Sign out`

## Privacy & permissions

- Auth tokens stored in VS Code's `SecretStorage` (encrypted at rest)
- File contents are sent to the Consilium API only when you explicitly run a "Debate" command
- Automatic git context attachment can be disabled per-workspace (`consilium.autoAttachGitContext`)
- The extension never auto-applies edits - every edit goes through a preview prompt

## Bring your own keys (BYOK)

Sign in once via `Consilium: Sign in`, then add provider keys at `https://myconsilium.xyz/settings`. The extension picks them up on the next debate. Without keys, the council runs on a managed free-tier pool (Groq + OpenRouter).

## Open source bits

- CLI: [`@myconsilium/cli`](https://www.npmjs.com/package/@myconsilium/cli) on npm
- TypeScript SDK: [`@myconsilium/sdk`](https://www.npmjs.com/package/@myconsilium/sdk)
- Python SDK: [`consilium`](https://pypi.org/project/consilium/) on PyPI
- MCP server: `consilium-mcp` (ships with the Python SDK)
- Repo: [github.com/skadri1601/consilium-vscode](https://github.com/skadri1601/consilium-vscode)

## Support

- Issues: https://github.com/skadri1601/consilium-vscode/issues
- Docs: https://myconsilium.xyz/docs
- Email: support@myconsilium.xyz
