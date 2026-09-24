# Installing the Bnd VS Code Extension

## Quick Install (from pre-built VSIX)

A pre-built extension package (`vscode-bnd-<version>.vsix`) is included in this directory.

### Option A: Via VS Code UI

1. Open Visual Studio Code.
2. Open the Extensions view with `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (macOS).
3. Click the `...` (More Actions) menu at the top-right of the Extensions panel.
4. Select **Install from VSIX…**
5. Navigate to this directory and select `vscode-bnd-<version>.vsix`.
6. Click **Install**.
7. Reload VS Code if prompted.

### Option B: Via Command Line

```bash
code --install-extension /path/to/vscode-bnd/vscode-bnd-<version>.vsix
```

Replace `/path/to/vscode-bnd/` with the actual path to this directory, e.g.:

```bash
# From the root of the bnd workspace:
code --install-extension vscode-bnd/vscode-bnd-<version>.vsix
```

## Build from Source

If you want to rebuild the extension (e.g., after updating the completion data):

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [npm](https://www.npmjs.com/) (bundled with Node.js)

### Build Steps

```bash
# Navigate to the extension directory
cd vscode-bnd-plugin

# Install client dependencies (includes vscode-languageclient)
npm install

# Install language server dependencies
npm install --prefix server

# Compile client + server TypeScript
npm run compile:all

# Compile VS Code extension tests
npm run compile:tests

# Run VS Code extension tests
npm test

# Package as a .vsix file
npm run package
```

This produces `vscode-bnd-<version>.vsix` in the current directory.  
Install it using either option above.

## Publish to the Visual Studio Marketplace

Publishing requires a Marketplace publisher named `bndtools` and a Personal Access Token with Marketplace publish rights.

```bash
# One-time login for the current shell/session
npx vsce login bndtools

# Publish the current package version from package.json
npm run publish

# Or publish as a pre-release
npm run publish:prerelease
```

You can also publish without storing credentials by setting `VSCE_PAT`:

```bash
VSCE_PAT=<marketplace-token> npm run publish
```

Before publishing, run:

```bash
npm run compile:all
npm run compile:tests
npm audit --omit=dev
npm run package
```

### Optional: Validate Against Upstream Java Source

The extension tests can validate CLI command parity against bnd Java source in `biz.aQute.bnd/src/aQute/bnd/main/bnd.java`.

Before `npm test`, set one of:

- `BND_SOURCE_REPO=<path-to-bnd-repo>`
- `BND_JAVA_REPO=<path-to-bnd-repo>`

If neither is set, tests also try sibling folder `../bnd`. If no source repo is available, parity checks are skipped.

## Language Server Startup Modes

The extension can launch the bnd server in different modes depending on your setup:

```jsonc
{
  "bnd.server.mode": "java",
  "bnd.server.jar": "",
  "bnd.server.javaExecutable": "",
  "bnd.server.jvmArgs": [],
  "bnd.server.socketPort": 5007
}
```

- `java` uses the bundled `server/biz.aQute.bnd.lsp.jar` and provides full bndlib-backed features.
- `node` runs the TypeScript LSP directly, providing completion and hover support.
- `socket` connects to a running TCP socket server.
- If the JAR is missing, the extension warns and falls back to the Node-based server. Resolve, build, and macro commands require the Java server or a compatible socket server.

## Verifying the Installation

1. Open any `.bnd` or `.bndrun` file in VS Code.
2. You should see syntax highlighting immediately.
3. Press `Ctrl+Space` on an empty line to see instruction/header completions.
4. Type `${` and press `Ctrl+Space` to see macro completions.
5. Hover over any known instruction (e.g., `-buildpath`) to see documentation.
6. Open the Command Palette and run `Bnd: Restart Language Server`.
7. Confirm the server starts in the selected mode and that LSP-backed commands like `Bnd: Resolve Runbundles (LSP)` and `Bnd: Evaluate Macro (LSP)` work.

## Uninstalling

1. Open the Extensions view (`Ctrl+Shift+X`).
2. Search for "bnd / bndtools".
3. Click the gear icon and select **Uninstall**.
