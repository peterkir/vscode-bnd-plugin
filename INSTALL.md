# Installing the Bnd VS Code Extension

## Quick Install (from pre-built VSIX)

Download `bnd-<version>.vsix` from the assets of the matching [GitHub Release](https://github.com/peterkir/vscode-bnd-plugin/releases). Every `v*.*.*` tag publishes one, and GitHub shows its SHA-256 digest.

### Option A: Via VS Code UI

1. Open Visual Studio Code.
2. Open the Extensions view with `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (macOS).
3. Click the `...` (More Actions) menu at the top-right of the Extensions panel.
4. Select **Install from VSIX…**
5. Select the downloaded `bnd-<version>.vsix`.
6. Click **Install**.
7. Reload VS Code if prompted.

### Option B: Via Command Line

```bash
code --install-extension /path/to/bnd-<version>.vsix
```

## Build from Source

If you want to rebuild the extension (e.g., after updating the completion data):

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [npm](https://www.npmjs.com/) (bundled with Node.js)
- VS Code 1.140.0 or later.
- Java 17 or later for the bundled bnd language server and bnd CLI. Native Java project import additionally requires Red Hat Java 1.56 or later and Java 21 or later for JDT LS.

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

This produces `bnd-<version>.vsix` in the current directory.  
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

- `java` uses `biz.aQute.bnd.lsp.jar` and provides full bndlib-backed features. By default the bundled `server/biz.aQute.bnd.lsp.jar` is used; run **Bnd: Select Language Server JAR...** to switch to a release, snapshot, custom URL, or local JAR (settings `bnd.server.jarSource`, `bnd.server.jarVersion`, `bnd.server.jarUrl`, `bnd.server.jarSha256`, `bnd.server.jar`).
- `node` runs the TypeScript LSP directly, providing completion and hover support.
- `socket` connects to a running TCP socket server.
- If the JAR is missing, the extension warns and falls back to the Node-based server. Resolve, build, and macro commands require the Java server or a compatible socket server.

### Feature Requirements

The bnd Activity Bar includes an independent **Explorer** and **Repositories**.
The file tree uses `bnd.explorer.exclude` (exact names, default `.git` and
`node_modules`) rather than `files.exclude`.

- **Repositories**, **Effective Properties**, and **Resolution** require a trusted workspace and a Java server advertising their commands. Older custom JARs and socket servers may lack them; use the bundled JAR or update the custom server.
- **Resolution** appears in the bottom Panel. It accepts saved `.bnd` and `.jar` files, not `.bndrun` files, and compares capabilities only among selected resources; it is not a full OSGi resolver.
- `.jar` files open in the read-only **bnd JAR Viewer** by default. Its **Tree** page works locally; its **Print** page requires `bnd.jar.printText` from the Java server.
- **Run/Debug OSGi** requires workspace trust, the Java server, and [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug). See [Run and Debug](walkthroughs/06-launch-debug.md) and [Browse Repositories](walkthroughs/07-repositories.md).

Native bnd project import runs independently in Red Hat Java's JDT LS. After
upgrading an existing unmanaged Java workspace, run **Java: Clean Java Language
Server Workspace** and allow reimport. For subsequent classpath refreshes,
use **Java: Reload Projects** and check
`java.configuration.updateBuildConfiguration`. Use execution-environment
names such as `JavaSE-21` in `java.configuration.runtimes`.

## Verifying the Installation

1. Open any `.bnd` or `.bndrun` file in VS Code.
2. You should see syntax highlighting immediately.
3. Press `Ctrl+Space` on an empty line to see instruction/header completions.
4. Type `${` and press `Ctrl+Space` to see macro completions.
5. Hover over any known instruction (e.g., `-buildpath`) to see documentation.
6. Open the Command Palette and run `Bnd: Restart Language Server`.
7. Confirm the server starts in the selected mode and that LSP-backed commands like `Bnd: Resolve Runbundles (LSP)` and `Bnd: Evaluate Macro (LSP)` work.

## Troubleshooting Language Server Startup

1. Open **View: Output** and select **bnd Language Server**. The first initialization exception usually appears before any process-exit message.
2. Run **Developer: Show Running Extensions** and confirm only the intended bnd extension is active.
3. Run **Developer: Open Logs Folder**, then inspect the current window's `exthost/exthost.log` and `exthost/output_logging_*/*bnd Language Server.log` files.
4. Enable Java server debug logging and run **Bnd: Restart Language Server**:

```jsonc
{
  "bnd.server.jvmArgs": [
    "-Dorg.slf4j.simpleLogger.defaultLogLevel=debug"
  ]
}
```

5. Temporarily set `bnd.server.mode` to `node`. If completion and hover then work, the extension host and document activation are healthy and the problem is specific to Java startup or Java server initialization.

An exit code of `0` means the Java process shut down cleanly. Look earlier in the output for the initialization error that caused the language client to send `shutdown` and `exit`.

## Uninstalling

1. Open the Extensions view (`Ctrl+Shift+X`).
2. Search for "bnd / bndtools".
3. Click the gear icon and select **Uninstall**.
