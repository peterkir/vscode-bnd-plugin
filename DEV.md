# Development, Testing, and Publishing Guide

Guide for developing, testing, packaging, publishing, and verifying the `vscode-bnd` extension.

---

## 1. Prerequisites

- **Node.js**: v18 or later
- **npm**: v9 or later (bundled with Node.js)
- **Java**: Java 17+ (required for bnd CLI JAR and Java-mode language server)
- **VS Code**: 1.140.0 or higher
- **VS Code Extension Publisher Account**: Personal Access Token (PAT) with `Marketplace (Manage)` permissions under publisher `klibio`

---

## 2. Workspace Setup

Clone and install dependencies for both extension client and embedded language server:

```bash
git clone https://github.com/peterkir/vscode-bnd-plugin.git
cd vscode-bnd-plugin

# Install extension client dependencies
npm install

# Install language server dependencies
npm install --prefix server
```

### Local Workspace Layout

This setup uses three separate workspaces:

| Purpose | Path |
|---|---|
| VS Code extension and TypeScript fallback LSP | This repository (`.`) |
| Upstream bnd Gradle workspace containing the Java LSP project | `../../bndtools/bnd.wt/fea-bnd-ls` |
| Sample bnd/RCP project to open in the development host | `../../klibio/example.bnd.rcp`, or the bundled fixture `examples/com.example.rcp` (see [Example RCP Workspace](#example-rcp-workspace)) |

The extension repository root is the extension development path. The Java LSP project is a subproject of the upstream bnd workspace; it is not the VS Code extension workspace. The sample project is opened in the Extension Development Host to exercise the extension against a real bnd workspace.

The relative paths above assume the repositories are checked out under the same `github.com` directory. Override them with `BND_LSP_WORKSPACE` or `BND_SAMPLE_WORKSPACE` if your checkout layout differs.

From Git Bash, install and compile the extension workspace:

```bash
cd /c/git/github.com/peterkir/vscode-bnd-plugin
npm install
npm install --prefix server
npm run compile:all
```

`compile:all` compiles the extension client and the Node-based fallback LSP. The Java LSP is supplied separately as `server/biz.aQute.bnd.lsp.jar`.

---

## 3. Development Workflow

### Build Scripts

| Command | Action |
|---|---|
| `npm run compile` | Compiles extension client (`src/` → `out/`) |
| `npm run compile:server` | Compiles TypeScript language server (`server/src/` → `server/out/`) |
| `npm run compile:all` | Compiles both client and server |
| `npm run compile:tests` | Compiles extension test suite |
| `npm run watch` | Watches and incrementally recompiles extension client |
| `npm run watch:server` | Watches and incrementally recompiles language server |

### Debugging in VS Code

1. Open workspace in VS Code.
2. Switch to **Run and Debug** view (`Ctrl+Shift+D`).
3. Select **Run Extension** configuration and press `F5`.
4. New **Extension Development Host** window launches with extension active.
5. Set breakpoints in `src/` or `server/src/`.

To launch the development extension directly on the sample workspace, close any older Extension Development Host and run this from Git Bash:

```bash
# Run from the extension repository root. Override any value for your setup.
VSCODE_CLI="${VSCODE_CLI:-code}"
BND_EXTENSION_DIR="${BND_EXTENSION_DIR:-$(pwd -W)}"
BND_SAMPLE_WORKSPACE="${BND_SAMPLE_WORKSPACE:-../../klibio/example.bnd.rcp}"

"$VSCODE_CLI" \
   --extensionDevelopmentPath="$BND_EXTENSION_DIR" \
   --new-window "$BND_SAMPLE_WORKSPACE"
```

If `code` is not on `PATH`, set `VSCODE_CLI` to your VS Code command-line launcher (for example, `/path/to/VSCode/bin/code`). Set `BND_SAMPLE_WORKSPACE` to an absolute path or a path relative to the current directory to use a different sample.

This opens the sample folder in a new Extension Development Host with the extension loaded from this checkout. Open a `.bnd` or `.bndrun` file to activate language features. In the host, use **Developer: Show Running Extensions** to confirm the active bnd extension comes from this repository, then use **View: Output** → **bnd Language Server** to inspect server startup. The default `bnd.server.mode` is `java`; set it to `node` in the Extension Development Host settings when specifically testing the TypeScript fallback.

Workspace settings override User settings. If the sample workspace's `.vscode/settings.json` sets `"bnd.server.mode": "node"`, the Node server starts even when your User settings select `java`, and restarting VS Code does not change that. Check the effective value with **Preferences: Open Workspace Settings (JSON)**; the output channel must show `Starting bnd Language Server JAR with Java ...` for Java-only features.

### Java Language Server Development (`biz.aQute.bnd.lsp`)

Upstream Java LSP server lives in:
- **Repo / Workspace**: `../../bndtools/bnd.wt/fea-bnd-ls` relative to this repository root (override with `BND_LSP_WORKSPACE`)
- **Project**: `$BND_LSP_WORKSPACE/biz.aQute.bnd.lsp`

To test modifications in `biz.aQute.bnd.lsp`:
1. Build the LSP JAR in the bnd workspace:
   ```bash
   BND_LSP_WORKSPACE="${BND_LSP_WORKSPACE:-../../bndtools/bnd.wt/fea-bnd-ls}"
   cd "$BND_LSP_WORKSPACE"
   ./gradlew :biz.aQute.bnd.lsp:build
   ```
2. In the Extension Development Host, configure User or Workspace `settings.json` to use the generated JAR:
   ```jsonc
   {
     "bnd.server.mode": "java",
     "bnd.server.jar": "<absolute path to the generated biz.aQute.bnd.lsp.jar>",
     "bnd.server.javaExecutable": "java"
   }
   ```
   In Git Bash, get the absolute Windows path to paste into that setting with `cygpath -w "$BND_LSP_WORKSPACE/biz.aQute.bnd.lsp/generated/biz.aQute.bnd.lsp.jar"`. VS Code settings do not expand arbitrary shell environment variables. Alternatively, run **bnd: Select Language Server JAR...** → **Local file...**, which writes the User setting. `bnd.server.jar` takes precedence over `bnd.server.jarSource`.
3. Restart the language server with **bnd: Restart Language Server**, or close and relaunch the development host. The extension launches a copy of the `bnd.server.jar` file from its global storage, so the build can overwrite the generated JAR while the server runs.

---

## 4. Local Testing

### Effective Editor

The optional `bnd.effective` custom text editor uses `workspace/executeCommand` with `bnd.properties.effective`. The request contains `uri`, `documentVersion`, `expanded`, and `merged`. The Java server evaluates an isolated snapshot of the current document and reads dependencies from disk. Responses use schema version 1 and contain rows, provenance URIs, diagnostics, dependency URIs, and generated effective source. Initialization must include `workspaceTrusted: true` to enable evaluation.

If the view reports `Effective properties require an updated Java bnd Language Server`, the running server did not advertise `bnd.properties.effective`. Usual causes: `bnd.server.mode` resolves to `node` (often through workspace settings), Java 17+ was not found and the extension fell back to Node, or `bnd.server.jar` points to an older JAR. Check **Output** → **bnd Language Server** for the startup line and Java version, fix the setting, then run **bnd: Restart Language Server** and refresh the view.

After Java changes, rebuild and update the bundled JAR before running `npm test`. The suite checks the actual bundled JAR, unsaved text, stale-version rejection, and custom-editor/source commands, not only Java compilation.

On Windows, a running development server may lock its generated JAR. Stop that development host before rebuilding, or temporarily set `target-dir: generated/effective` in the Java LSP project's `bnd.bnd`, build there, and restore the setting afterward. Changing only `-outputmask` is insufficient because bnd also writes a canonical JAR name. Do not replace a running user's server process without approval.

### Native JDT LS Adapter

`contributes.javaExtensions` loads `server/jdtls/org.bndtools.jdtls.adapter.jar` into Red Hat Java's JDT LS. Its importer runs ahead of Gradle and creates source/test entries, separate outputs, compiler settings, JRE mapping and a bnd dependency container. Build support refreshes project models after `.bnd` or `.mvn` changes; a configuration project tracks `cnf`. Imported bnd metadata is managed by this adapter, not Buildship. Source/output directories outside the project are currently rejected.

Build with Java 21 or later and the installed JDT LS core API JAR:

```bash
export JDT_LS_HOME="$(cygpath -m "$HOME/.vscode/extensions/redhat.java-1.56.0-win32-x64/server")"
export JDT_LS_CORE_JAR="$(find "$JDT_LS_HOME/plugins" -name 'org.eclipse.jdt.ls.core_*.jar' -print -quit)"
export JAVA_HOME="$(cygpath -m "$HOME/.ecdev/java/ee/JAVA25")"
export PATH="$(cygpath -u "$JAVA_HOME")/bin:$PATH"
BND_LSP_WORKSPACE="${BND_LSP_WORKSPACE:-../../bndtools/bnd.wt/fea-bnd-ls}"
"$BND_LSP_WORKSPACE/gradlew" -p "$BND_LSP_WORKSPACE" :org.bndtools.jdtls.adapter:jar
cp "$BND_LSP_WORKSPACE/org.bndtools.jdtls.adapter/generated/org.bndtools.jdtls.adapter.jar" server/jdtls/
```

`npm run test:jdtls` starts an isolated JDT LS and temporary bnd workspace, checking native import, a real dependency JAR, source/test outputs and live classpath refresh. Set `JDT_LS_HOME`, `JDT_LS_JAVA` (Java executable) and `JDT_LS_JAVA_HOME` (Java 21 JDK home). `BND_JDT_LS_JAR` optionally selects a freshly built adapter. This check does not modify the running user's Java workspace. For manual verification, clean the development host's Java language-server workspace and reimport, then inspect dependencies and source roots before checking breakpoints.

For a classpath refresh without clearing the workspace, run **Java: Reload Projects** (`java.projectConfiguration.update` in Red Hat Java 1.56). Check `java.configuration.updateBuildConfiguration` if saved configuration changes do not refresh automatically: `automatic` applies updates, `interactive` asks for approval, and `disabled` requires a manual reload. A clean Java workspace is still needed when replacing stale unmanaged project metadata after upgrading the adapter.

### Repositories View

File-specific actions in the bnd Explorer use the selected tree item's context value rather than editor resource keys. Run/Debug and Run/Debug Tests appear for `.bndrun` and `bnd.bnd` files; Effective appears for `.bnd`/`.bndrun`, Resolution for `.bnd`/`.jar`, and the JAR viewer for `.jar`. These actions do not depend on the active editor. Other `.bnd` files are not launch targets.

`src/bndExplorer.ts` registers a separate `bnd.explorer` workspace file tree before `bnd.repositories`. It reads directories lazily through `workspace.fs` and has its own exact-name exclusions (`bnd.explorer.exclude`), without changing the native Explorer. The tree mirrors the built-in Explorer context menu (groups `navigation`, `3_compare`, `4_search`, `5_cutcopypaste`, `6_copypath`, `7_modification`) and its keybindings under `focusedView == bnd.explorer`. Create, rename, move and delete go through `WorkspaceEdit`, so rename/refactoring participants run and the operations can be undone; copy uses `workspace.fs.copy`. Menus that other extensions contribute to `explorer/context` cannot be reused for a custom tree. Workspace-folder, file create/delete and configuration changes refresh it. Manifest order is only the default; VS Code preserves user view customization.

`src/bndRepositories.ts` contributes the `bnd.repositories` tree view in the `bnd` Activity Bar container (`media/bndtools.svg`). Every request is one JSON object with a `workspace` URI (the folder containing `cnf/build.bnd`). Repositories are addressed by `repo` (index in the list response; index 0 is the Workspace repository) and `repoName`; a name mismatch is rejected, so refresh the view after configuration changes. The Java server (`BndRepositoriesService`) handles:

| Command | Request | Response |
|---|---|---|
| `bnd.repositories.list` | `workspace` | `offline`, `repositories[]` with `index`, `name`, `kind`, `title`, `tooltip`, `location`, `status`, `writable`, `remote`, `refreshable`, `actionable`, `searchable`, `p2`, `tags` |
| `bnd.repositories.bundles` | `repo`, `filter` | `bundles[]` (`bsn`, `title`, `tooltip`, `project` for the Workspace repository), `features[]` for P2 |
| `bnd.repositories.versions` | `repo`, `bsn` | `versions[]`, newest first |
| `bnd.repositories.feature` | `repo`, `id`, `version` | `plugins[]`, `includes[]`, `requires[]` |
| `bnd.repositories.get` | `repo`, `bsn`, `version` | local `file` and `uri` |
| `bnd.repositories.search` | `namespace`, `filter` | `results[]` from repositories implementing the OSGi Repository API |
| `bnd.repositories.listActions` / `runAction` | `repo`, optional `bsn`, `version`, `label` | `Actionable` labels / runs one |
| `bnd.repositories.reload` | optional `repo` | `refreshed[]` |
| `bnd.repositories.put` | `repo`, `files[]` (URIs) | `added[]` |
| `bnd.repositories.fetch` | `repo`, optional `bsn`, `version` | `downloaded`, `errors[]` |
| `bnd.workspace.offline` | optional `offline` | current `offline` state |

All commands require `workspaceTrusted: true`. Manual checks: browse the sample workspace, filter, run a package search, copy an entry, drag a version into `-buildpath`, drop a JAR on a writable repository, toggle offline, and verify the welcome text in Node mode.

### Resolution View

`src/resolutionView.ts` contributes **Resolution** to the built-in Panel alongside Terminal, Problems, and Debug Console. Add the active `.bnd`/`.jar` file, choose files, or use **Analyze in Resolution View** on a repository version. The Java LSP command `bnd.resolution.analyze` builds OSGi resources and returns their requirements, capabilities, and capability matches. The view groups rows by namespace, supports wildcard/multi-term filtering, hides optional requirements, filters unresolved requirements, and copies row details.

Repository selection replaces the persisted resource list; drag-and-drop and **Analyze in Resolution View** append to it. Unversioned repository bundles are downloaded at their newest listed version. Selection and analysis revision counters prevent older asynchronous responses from replacing newer results. The request is `{ uris: string[] }` with 1-100 saved local `.bnd`/`.jar` files; the response contains `resources[]` (absolute paths), `requirements[]`, and `capabilities[]`. Rows contain `source`, `namespace`, `attributes`, and `directives`; requirement rows add `optional` and `resolved`. `bnd.bnd` uses the first project sub-builder; another `.bnd` file uses its own sub-builder. Matching only checks selected capabilities against requirement namespace/filter, not complete OSGi wiring. Missing or invalid filters remain unresolved. `.bndrun` files are not accepted.

Manual checks: analyze a `.bnd` project file and a bundle JAR that imports a package, drag its provider JAR from Repositories to add it, verify the requirement changes to matched, select a repository version to replace the analysis, filter by namespace and source, toggle optional/unresolved filters, remove one source, clear all sources, reopen the view to check persisted resources, and confirm unsupported/Node mode reports the missing Java LSP capability without changing source files.

### JAR Viewer

`src/jarViewer.ts` registers the `bnd.jarViewer` custom read-only editor (default for `*.jar`), the `bnd.jar.open` command, and a read-only `bnd-jar:` file system (`bnd-jar:/<entry>?<jar URI>`) used to open entries in normal editors. The ZIP central directory (including ZIP64) is parsed in TypeScript, and entries are inflated with Node `zlib`. The Tree page follows the bndtools `JARTreeEntryPart` rules: Auto shows hex when the data contains a zero byte, hex output matches `aQute.lib.hex.Hex.format`, and Limit reads at most 1,000,000 bytes. The Print page sends `bnd.jar.printText` with `{ uri }`; the Java server (`BndWorkspaceService`) returns `{ text }` from `JarPrinter.doPrint(jar, -1, false, false)`, which matches the Eclipse Print page.

Manual checks: open a bundle from the Explorer, navigate the tree with the keyboard, switch Show As/encoding/Limit on a class file and a large text entry, open an entry in an editor, search the Print page with `Ctrl+F`, rebuild the JAR while it is open, and verify that Print reports the missing capability in Node mode.

### Launch and Debug

`src/bndLaunch.ts` registers the `bnd` debug type. `resolveDebugConfigurationWithSubstitutedVariables` sends `bnd.launch.prepare` with `{ uri, kind: "run" | "test", tests, build }`. The Java server (`BndLaunchService`) creates a `Run` for `.bndrun` files or uses the workspace `Project` for `bnd.bnd`, optionally builds dependencies, prepares a `ProjectLauncher` (or `ProjectTester` for tests), and keeps it alive under a UUID. The response contains `launchId`, `mainClass`, `classPaths`, `vmArgs`, `args`, `env`, `cwd`, `javaExecutable`, `runee`, `name`, and `warnings`, or `error`/`errors`. The client converts it to a `java` launch configuration, starts it with Debugger for Java, and cancels the original `bnd` session. When the Java session terminates, the client sends `bnd.launch.dispose` with the launch ID; the server calls `ProjectLauncher.cleanup()` and deletes temporary launcher files. Exception: a `noDebug` session with a terminal console terminates right after spawning the JVM, before it reads `launch*.properties`; the client keeps that launch per target and disposes it when the same target is prepared again. Server shutdown disposes all open launches. `bnd.launch.prepare` requires `workspaceTrusted: true`.

Manual checks: run and debug from CodeLens and both Explorer context menus, then invoke the Command Palette with no launch file active and choose a target. Verify launch cancellation and unsaved-file prompts, test selection, breakpoints in imported workspace sources, and temporary-file cleanup after the Java session ends (for terminal runs without debugging: after relaunching the same target or restarting the server). Effective commands accept both a URI and a bnd Explorer node containing `uri`; verify **Open Effective to Side** on a tree selection without an active source editor.

### Automated Test Suite

Run automated extension tests using VS Code test runner:

```bash
# Compile and run test suite
npm test
```

`npm test` automatically runs `npm run pretest` (`compile:all` + `compile:tests`), then launches VS Code Extension Test Host.

The automated test host is separate from the sample workspace launch above. It opens the extension test suite, not `example.bnd.rcp`. Tests that start the Java LSP use the bundled `server/biz.aQute.bnd.lsp.jar`; rebuild/update that JAR before testing Java LSP changes. `npm test` uses a locally discoverable VS Code executable when available, otherwise the VS Code test runner may download one.

#### Upstream CLI Parity Tests

The test suite includes parity checks against `biz.aQute.bnd` CLI options. To run parity checks against upstream bnd Java source:

```bash
# Point to local bnd repository
export BND_SOURCE_REPO="/path/to/bnd"
# or export BND_JAVA_REPO="/path/to/bnd"

npm test
```

If neither environment variable is set and `../bnd` does not exist, parity tests are cleanly skipped.

### Manual Verification in Extension Development Host

Launch the workspace configured by `BND_SAMPLE_WORKSPACE` using the command above, then open its `.bnd` and `.bndrun` files in the Extension Development Host and test:

1. **Syntax Highlighting**:
   - Check headers, instructions (`-keyword:`), macros (`${...}`), line continuations (`\`), and comments (`#`, `//`).
2. **Completions & Hover**:
   - Instructions / headers completion (`Ctrl+Space`).
   - Macro completions (`${`).
   - Hover cards showing signatures, docs, and code examples.
3. **Language Server Modes**:
   - Test `bnd.server.mode`: `node`, `java`, `socket`.
   - Run command: `bnd: Restart Language Server`.
   - Run command: `bnd: Resolve Runbundles (LSP)`.
   - Run command: `bnd: Build Project (LSP)`.
   - Run command: `bnd: Evaluate Macro (LSP)`.
4. **CLI Commands**:
   - Run `bnd-cli: Build Project`, `bnd-cli: Resolve (.bndrun)`, `bnd-cli: Run`.
   - Run `bnd-cli: Configure bnd Library...` to verify JAR acquisition and path configuration.
   - Run `bnd-cli: Toggle CLI Commands in Command Palette` twice. Confirm other `bnd-cli:` entries hide and return, the toggle remains visible, and User settings are not modified. Disable the CLI entries and reload the host to verify the extension's global storage restores the choice. Before the first toggle, `bnd.cli.showCommands` supplies the initial value; afterward, the saved choice takes precedence. Commands under `bnd:` and context-menu actions must remain available.
   - Run `bnd-cli: Discover Java Runtimes from Folder...`.
   - Run `bnd-cli: Show CLI Reference` to check webview functionality.

### Example RCP Workspace

`examples/com.example.rcp/` is a bnd workspace generated by the extension's workspace wizards: the minimal [bndtools.workspace.min](https://github.com/bndtools/bndtools.workspace.min) template plus the **Eclipse RCP E4 Application** and **Eclipse RCP SWTBot Tests** fragments from [bndtools/workspace-templates](https://github.com/bndtools/workspace-templates). It contains:

| Path | Content |
|---|---|
| `cnf/ext/eclipse_4.41_platform.bnd`, `cnf/ext/swtbot_4.3.0.bnd` | P2 repository plugins for the Eclipse Platform and SWTBot update sites |
| `example.rcp.app.ui/` | Eclipse 4 application (model, handlers, CSS) with `app.ui_<os>.<ws>.<arch>.bndrun` launch files |
| `example.rcp.app.ui.swtbot.tests/` | `SamplePartSWTBotTest` driving the application with SWTBot; `swtbot_<os>.<ws>.<arch>.bndrun` include the matching application `.bndrun` and `swtbot_shared.bndrun` (`-tester: biz.aQute.junit`, tests on a separate thread so SWT keeps the main thread) |

It is used for the wizard and P2 screenshots and is a ready-made workspace for manual testing of P2 repositories, feature trees, launching, and OSGi tests in the Extension Development Host. Caches (`cnf/cache`), generated P2 indexes (`cnf/ext/*.index.xml.gz`), and build output are not stored. The fixture is excluded from the VSIX.

Two deviations from upstream are applied on purpose: `cnf/ext/swtbot_4.3.0.bnd` uses `url`/`cache` instead of the `url.`/`cache.` keys written by the fragment (which P2Repository rejects), and the P2 indexes must be created on first access, which needs network access to `download.eclipse.org`.

`scripts/exampleWorkspace.mjs` (also `npm run example -- <command>`) maintains and uses the fixture:

```bash
# Copy the fixture to a scratch folder (default /tmp/bnd-demo/com.example.rcp) and open it in an Extension Development Host
npm run example -- prepare --open
# ... or just copy it and print the `code` command
npm run example -- prepare /path/to/scratch

# Build the projects and run the SWTBot tests for this OS/architecture with the bnd CLI
# (requires a built workspace; set BND_CLI to a bnd 7.4+ CLI if `bnd` is not on PATH)
BND_CLI="java -Djdk.xml.maxGeneralEntitySizeLimit=0 -jar /path/to/biz.aQute.bnd.jar" npm run example -- test /tmp/bnd-demo/com.example.rcp

# Regenerate the fixture headlessly from the upstream templates using the bundled Java language server
npm run example -- generate
# Store a workspace that was created with the VS Code wizards as the new fixture
npm run example -- import /path/to/generated/workspace
```

`test` selects `swtbot_macosx.cocoa.aarch64.bndrun`, `swtbot_macosx.cocoa.x86-64.bndrun`, `swtbot_linux.gtk.x86-64.bndrun`, or `swtbot_win32.win32.x86-64.bndrun` from the current platform, runs `bnd build` and then `bnd runtests --workspace . --reportdir reports <bndrun>`; the JUnit XML reports land in `reports/`. The SWTBot tests open the application window, so run them on a machine with a display. Inside VS Code, the same tests run through the **Run OSGi tests** / **Debug OSGi tests** CodeLens on the platform `swtbot_*.bndrun`, and the application starts through **Run OSGi** on the platform `app.ui_*.bndrun`. Java 21 or newer is required by the fragments.

`generate` and `import` strip caches and build output and apply the `swtbot_*.bnd` repair; `generate` produces the same tree as the VS Code wizards because it calls the same `bnd.wizard.*` language-server commands over JSON-RPC. Review the diff after regenerating, because upstream fragment changes (new Eclipse releases, renamed projects) flow into the fixture.

### Documentation Screenshots

`scripts/screenshots.mjs` regenerates the images in `docs/images/` that README.md and the walkthroughs embed. It launches an Extension Development Host from a VS Code installation with Playwright (Electron automation), drives the UI through DOM locators, and saves 1440×900 PNGs with the `Default Dark Modern` theme. The script uses an isolated user-data and extensions directory and does not change your VS Code settings.

```bash
npm run compile:all
npm install --no-save playwright-core        # automation library; not a project dependency
BND_DEMO_WORKSPACE=/path/to/bnd node scripts/screenshots.mjs
```

| Variable / flag | Purpose |
|---|---|
| `VSCODE_EXECUTABLE_PATH` | Electron binary of a VS Code installation (default: `/Applications/Visual Studio Code.app/Contents/MacOS/Code`). |
| `BND_DEMO_WORKSPACE` | An existing bnd workspace (the bnd source checkout is used for the published images). It supplies the editor, repository, Resolution, JAR Viewer, and launch screenshots. It is opened read-only apart from a temporary `docs.screenshots.tmp` project that is removed afterwards. Omit it to skip these images. |
| `BND_SHOT_DIR` | Output directory (default `docs/images`). |
| `--only=name,name` | Capture only the listed images, e.g. `--only=wizard-welcome,effective`. |
| `--keep` | Keep the temporary user-data directory for log inspection. |

The wizard images are produced from an empty folder (`/tmp/bnd-demo/com.example.rcp`): the script creates the minimal workspace, then adds the **Eclipse RCP E4 Application** and **Eclipse RCP SWTBot Tests** fragments from the upstream catalog, so network access to GitHub and `download.eclipse.org` is required. Indexing the Eclipse P2 repositories for `repositories-p2.png` can take several minutes on first run; the generated folder is reused when only fragment or P2 images are requested, and is seeded from `examples/com.example.rcp` when it does not exist yet.

The script works around two upstream issues: it repairs the `url.`/`cache.` keys in the `swtbot-tests` fragment's `cnf/ext/swtbot_*.bnd` so the SWTBot P2 repository loads, and it starts the language server with `-Djdk.xml.maxGeneralEntitySizeLimit=0 -Djdk.xml.totalEntitySizeLimit=0`, because Java 24+ rejects the Eclipse Platform P2 index otherwise. Review new images before committing; the repository `.gitignore` excludes nothing under `docs/images/`.

---

## 5. Packaging

Build a `.vsix` installer package:

```bash
# Standard release packaging
npm run package

# Pre-release packaging
npm run package:prerelease
```

This generates `bnd-<version>.vsix` in root directory without modifying git tags. Tagged releases attach the same file to the GitHub Release (see [Publishing](#6-publishing)).

Packaging runs `vscode:prepublish` (`compile:all`, then `bundle`). `bundle` uses esbuild to overwrite `out/extension.js` and `server/out/server.js` with self-contained, minified bundles, so `.vscodeignore` excludes `node_modules/` (except the Codicons font and CSS used by the Effective view), other `out/` files, and source maps. Run `npm run compile:all` afterwards to restore unbundled output for debugging; `npm test` does this automatically.

### Inspect Package Contents

Verify files included in VSIX bundle:

```bash
npx @vscode/vsce ls
```

Ensure no test fixtures, uncompiled sources, or extraneous artifacts are bundled, and that `vsce` reports no bundling warning (the package contains about 25 files).

---

## 6. Publishing

### Step 1: Version Bump & Changelog

1. Update `"version"` in `package.json`.
2. Document release notes and changes in `CHANGELOG.md`.
3. Commit version changes:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: release v<version>"
   git tag "v<version>"
   git push origin main --tags
   ```

Pushing a `v*.*.*` tag runs the **Release** workflow (`.github/workflows/release.yml`). The tagged commit must be on the default branch (`main`); otherwise the run fails before packaging and nothing is released or published. The workflow packages the VSIX, creates the GitHub Release `bnd v<version>` with generated release notes and `bnd-<version>.vsix` attached for download (the run fails if no VSIX was produced), and publishes to the Marketplace when the `VSCE_PAT` secret is set. A manual run for a tag that already has a release updates that release and replaces the VSIX asset. To rerun it manually, use **Actions** → **Release** → **Run workflow**, enter an existing tag, and enable **Publish to VS Code Marketplace** only when the Marketplace upload is wanted.

### Step 2: Publish to Visual Studio Marketplace

Ensure `VSCE_PAT` environment variable is set with Personal Access Token:

```bash
# Standard production release
npm run publish -- -p <YOUR_PERSONAL_ACCESS_TOKEN>

# Or pre-release track
npm run publish:prerelease -- -p <YOUR_PERSONAL_ACCESS_TOKEN>
```

Alternatively, upload `.vsix` manually via [Visual Studio Marketplace Management Portal](https://marketplace.visualstudio.com/manage).

### Step 3: Publish to Open VSX Registry (Optional)

If publishing to [Open VSX](https://open-vsx.org/):

```bash
npx ovsx publish bnd-<version>.vsix -p <OPEN_VSX_PAT>
```

---

## 7. Testing Published Version

### Step 1: Install from Marketplace

1. Open standard VS Code (clean profile recommended).
2. Install extension via CLI:
   ```bash
   code --install-extension klibio.bnd --force
   ```
   Or search `bnd` / `klibio` in Extensions view (`Ctrl+Shift+X`) and click **Install**.

### Step 2: Clean Profile Verification

To test without interference from previous configuration:

```bash
# Launch fresh isolated VS Code profile
code --profile "Bnd-Test" --extensions-dir ~/.vscode/extensions-test
```

### Step 3: Smoke Test Matrix

| Area | Test Steps | Expected Result |
|---|---|---|
| Activation | Open any `bnd.bnd` or `launch.bndrun` | Status bar shows bnd LSP activating; syntax highlighting applied |
| IntelliSense | Type `-run` + `Ctrl+Space` | Completion items with bnd doc snippets appear |
| Hover | Hover over `-buildpath:` | Hover tooltip renders with description and example |
| LSP Commands | `Ctrl+Shift+P` → `bnd: Restart Language Server` | Server restarts cleanly without errors |
| CLI Library | `Ctrl+Shift+P` → `bnd-cli: Configure bnd Library...` | Selects a CLI JAR and updates `bnd.cli.executable` |
| CLI Commands | `Ctrl+Shift+P` → `bnd-cli: Show CLI Reference` | Searchable reference webview opens with all commands |

### Step 4: Uninstall / Upgrade Check

```bash
# Uninstall
code --uninstall-extension klibio.bnd

# Re-install
code --install-extension klibio.bnd
```
