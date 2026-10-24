# Continue — Neil

Personal Cursor build of Continue, published from this fork as
`MrNaughtZero.continue-neil`. The upstream project is archived; this fork adds
local improvements while retaining Continue's existing session format and
`~/.continue` configuration and history directory.

## Chat controls

- **New chat** and **History** are always visible above the conversation.
  Stop an active run and wait for running tools to finish before switching chats.
  New chat saves the current conversation before clearing the screen.
- **Allow this chat** beside a tool request approves that tool for the current
  open chat only. Opening another chat or reloading the extension resets these
  permissions. **Reset permissions** clears them immediately. Globally excluded
  tools and explicitly blocked terminal commands still apply. For terminal tools,
  this approval also covers command-specific confirmation prompts. The header's
  **Allow terminal this chat** toggle enables the same mode without running a
  pending command; click it again to restore prompts. Existing global tool settings
  remain available in Tools.
- Web requests offer **Allow web for chat**, covering both search and reading URLs.
  **Allow Playwright for chat** covers all enabled tools on the configured
  **Chrome (Playwright)** server. These are the primary acceptance actions,
  including the keyboard shortcut. **Accept once** runs just that request.
  One approval also handles already-pending requests in the same group. These
  grants use the same open-chat lifetime and reset control described above;
  unrelated servers and tools do not inherit them.
- During a run, type additional context and press **Enter twice within 1.5 seconds**,
  or click the send arrow. The current model response is interrupted and the new
  message is appended while retaining the original task. A running tool finishes
  first. Stop clears queued messages; it does not forcibly kill a running tool.
- Reasoning, long paths, tables and code are constrained to the panel width;
  code and tables can scroll horizontally.
- Workspace roots are refreshed before each compiled chat request. Folder
  attachments retain their full directory reference even when indexing fails.
  Large V2 thinking-only completions report an explicit error instead of silently
  ending without an answer.

## Usage

The Usage panel shows cumulative input/output tokens for recorded requests,
reasoning tokens when the provider reports them, the last compiled input size,
context capacity, estimated token cost, and Venice balances. No API keys are sent
to the panel. Balances are fetched by the extension backend and cached for 30s.

Old chats have no retroactive usage measurements. Fallback token counts are
labelled estimates. Cost uses the current model's published token rates for each
recorded request's model identifier; it is not a billing receipt and excludes
interrupted requests, auxiliary requests (such as title generation), extra
services and cache discounts. Actual account billing is reflected in the balance.

## Existing Chrome tabs

Install Microsoft's **Playwright Extension** from the Chrome Web Store, then add
this server to the existing `mcpServers` list in `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: Chrome (Playwright)
    command: npx
    args: [--yes, "@playwright/mcp@0.0.83", --extension, --browser, chrome]
    connectionTimeout: 60000
```

Cursor must be able to find Node/npm. On systems using a Node version manager,
use the absolute `npx` path and an `env.PATH` containing the corresponding Node
binary directory. This installation is configured that way.

The first browser action opens the extension's connection/tab chooser. The
permission screen warns that approval exposes the entire signed-in browser,
including cookies and other tabs/windows, and may permit later reconnection.
Selecting a tab chooses the initial target; it is not an access boundary.
Continue's tool approval settings still apply. No auto-authentication token is
installed in the configuration by this fork.

This Mac's signed-in browser is `Profile 1`. If automatic profile discovery fails,
the supported `--profile-dir-name "Profile 1" --executable-path
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` options route the
connection directly to that existing browser. They retain the connection dialog.

## Build and install

Install the upstream root, core, GUI and VS Code dependencies and build packages
with `node scripts/build-packages.js`. On modern Node versions the VS Code
package's legacy sqlite postinstall may fail; `npm ci --ignore-scripts` in
`extensions/vscode` followed by `npm rebuild @vscode/ripgrep` avoids that redundant
build. Prepackage uses the core's sqlite native binary. All required native
artifacts are validated by upstream's prepackage script.

With dependencies prepared, run `bash scripts/build-neil.sh`. The macOS ARM64
VSIX is written to `extensions/vscode/build/`. Back up `~/.continue/sessions`,
configuration and the current extension before replacing an installation.
Remove the original `Continue.continue` extension to avoid duplicate command/view
IDs, install the new VSIX, and reload Cursor. Do not delete `~/.continue`.

Validation includes TypeScript/GUI build, extension bundling, existing chat and
tool-flow tests, and new steering/session-permission/workspace/empty-reply tests.
The runtime still depends on the selected model's reliability and availability.
