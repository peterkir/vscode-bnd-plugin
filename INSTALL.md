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

### Optional: Validate Against Upstream Java Source

The extension tests can validate CLI command parity against bnd Java source in `biz.aQute.bnd/src/aQute/bnd/main/bnd.java`.

Before `npm test`, set one of:

- `BND_SOURCE_REPO=<path-to-bnd-repo>`
- `BND_JAVA_REPO=<path-to-bnd-repo>`

If neither is set, tests also try sibling folder `../bnd`. If no source repo is available, parity checks are skipped.

## Verifying the Installation

1. Open any `.bnd` or `.bndrun` file in VS Code.
2. You should see syntax highlighting immediately.
3. Press `Ctrl+Space` on an empty line to see instruction/header completions.
4. Type `${` and press `Ctrl+Space` to see macro completions.
5. Hover over any known instruction (e.g., `-buildpath`) to see documentation.

## Uninstalling

1. Open the Extensions view (`Ctrl+Shift+X`).
2. Search for "bnd / bndtools".
3. Click the gear icon and select **Uninstall**.
