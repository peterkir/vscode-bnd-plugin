# Development, Testing, and Publishing Guide

Guide for developing, testing, packaging, publishing, and verifying the `vscode-bnd` extension.

---

## 1. Prerequisites

- **Node.js**: v20 (matches GitHub Actions)
- **npm**: v9 or later (bundled with Node.js)
- **Java**: Java 17+ (required for bnd CLI JAR and Java-mode language server)
- **VS Code**: 1.140.0 or higher
- **GitHub CLI**: `gh`, authenticated with `gh auth login`, for PRs, CI artifacts, and release checks
- **Release maintainers only**: access to publisher `klibio` and repository Actions secret `VSCE_PAT` with `Marketplace (Manage)` permissions. Never put tokens in commits, command arguments, or PR text.

---

## 2. Workspace Setup

Clone and install dependencies for both extension client and embedded language server:

```bash
git clone https://github.com/peterkir/vscode-bnd-plugin.git
cd vscode-bnd-plugin

# Install extension client dependencies
npm ci

# Install language server dependencies
npm ci --prefix server
```

### Local Workspace Layout

This setup uses three separate workspaces:

| Purpose | Path |
|---|---|
| VS Code extension and TypeScript fallback LSP | This repository (`.`) |
| Upstream bnd Gradle workspace containing the Java LSP project | `../../bndtools/bnd.wt/fea-bnd-ls` |
| Sample bnd/RCP project to open in the development host | `../../klibio/example.bnd.rcp` |

The extension repository root is the extension development path. The Java LSP project is a subproject of the upstream bnd workspace; it is not the VS Code extension workspace. The sample project is opened in the Extension Development Host to exercise the extension against a real bnd workspace.

The relative paths above assume the repositories are checked out under the same `github.com` directory. Override them with `BND_LSP_WORKSPACE` or `BND_SAMPLE_WORKSPACE` if your checkout layout differs.

From Git Bash, install and compile the extension workspace:

```bash
cd /c/git/github.com/peterkir/vscode-bnd-plugin
npm ci
npm ci --prefix server
npm run compile:all
```

`compile:all` compiles the extension client and the Node-based fallback LSP. The Java LSP is supplied separately as `server/biz.aQute.bnd.lsp.jar`.

---

## 3. Development Workflow

Start each change on a feature branch from current `main` with a clean worktree:

```bash
git switch main
git pull --ff-only origin main
git switch -c fea-describe-change
```

Make focused changes and update affected English documentation. For every code change, bump the extension version using `npm version patch --no-git-tag-version` (use `minor` for compatible features or `major` for breaking changes). This updates both `package.json` and `package-lock.json` without committing or tagging. Update `CHANGELOG.md` for user-visible changes. Documentation-only changes do not require a version bump.

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

If neither environment variable is set and `../bnd` does not exist, parity tests are skipped. A skipped parity test is not full validation: set an existing source checkout before signing off a code change. For this checkout layout, use `export BND_SOURCE_REPO="$(cd ../../bndtools/bnd.wt/fea-bnd-ls && pwd -W)"` in Git Bash; elsewhere use your own absolute path.

CI also downloads bnd CLI 7.4.0 and sets `BND_CLI_JAR` for real CLI invocation tests. For equivalent local coverage, set `BND_CLI_JAR` to that JAR and inspect the test summary for unexpected skips; source parity alone does not prove CLI execution works. Native JDT LS testing is a separate `npm run test:jdtls` check, not part of the default CI workflow.

If Windows reports that tests require no other running Code instance, close other instances or set `VSCODE_EXECUTABLE_PATH` to a separate test installation's executable. An update-in-progress or blocked test host is a blocker, not a passing test run.

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

---

## 5. Packaging

Build a `.vsix` installer package:

```bash
# Standard release packaging
npm run package

# Pre-release packaging
npm run package:prerelease
```

This generates `bnd-<version>.vsix` in root directory without modifying git tags. Tagged releases build their own VSIX and attach it to the GitHub Release (see [Publishing](#6-publishing)). A local build is not a substitute for testing the remote CI artifact.

Packaging runs `vscode:prepublish` (`compile:all`, then `bundle`). `bundle` uses esbuild to overwrite `out/extension.js` and `server/out/server.js` with self-contained, minified bundles, so `.vscodeignore` excludes `node_modules/` (except the Codicons font and CSS used by the Effective view), other `out/` files, and source maps. Run `npm run compile:all` afterwards to restore unbundled output for debugging; `npm test` does this automatically.

### Inspect Package Contents

Verify files included in VSIX bundle:

```bash
npx @vscode/vsce ls
```

Ensure no test fixtures, uncompiled sources, or extraneous artifacts are bundled, and that `vsce` reports no bundling warning (the package contains about 25 files).

---

## 6. Publishing

Normal path: local development and tests, signed-off commit, PR, green PR CI and remote VSIX smoke test, merge to `main`, green main CI and remote VSIX smoke test, release tag, Marketplace verification. Use [CHECKLIST.md](CHECKLIST.md) for signoff.

### Step 1: Validate, Commit, and Open a PR

Run `npm test` with `BND_SOURCE_REPO` and `BND_CLI_JAR` set as described above; it compiles client, fallback server, and tests before running the complete extension suite. Perform the relevant development-host checks, run `npm run package`, and inspect `npx @vscode/vsce ls`. Resolve failures and unexpected skips before proceeding.

Review and stage only files belonging to the change, including both package files when the version changes:

```bash
git status --short
git diff --check
git diff
# Replace these example paths with the files belonging to your change.
git add src/extension.ts package.json package-lock.json CHANGELOG.md DEV.md
git diff --cached
git commit -s
# In the editor, describe summary, reason, changes, and validation results.
git push -u origin HEAD
gh pr create --base main --fill
```

Include test results, any blocked/skipped checks, Java JAR provenance when changed, and manual checks in the PR. Do not commit VSIX files, downloaded CLI JARs, credentials, or generated TypeScript output. Bundled Java server/adapter JAR updates are intentional source-controlled exceptions when those components change.

### Step 2: Test the Remote PR Build

`.github/workflows/ci.yml` runs for PRs and pushes to `main`/`master`; pushing a feature branch alone does not trigger it until a PR exists. On Ubuntu 24.04 it installs locked dependencies with Node 20, compiles TypeScript, sets up Java 17, checks out bnd source from `fea-bnd-ls`, verifies a downloaded bnd CLI 7.4.0 JAR against its SHA-1, runs `xvfb-run -a npm test`, then packages and uploads `bnd-<version>.vsix` with 30-day retention. It does not rebuild the bundled Java JARs or run the separate JDT LS integration check.

```bash
gh pr checks --watch
gh run list --workflow ci.yml --branch "$(git branch --show-current)" --event pull_request --limit 5
# Set this to the run ID for the current PR revision, not an older successful run.
RUN_ID=1234567890
gh run watch "$RUN_ID" --exit-status
gh run view "$RUN_ID" --json headBranch,headSha,event,conclusion,url
bash scripts/try-ci-vsix.sh "$RUN_ID" ../../klibio/example.bnd.rcp
```

Verify the run's PR and revision in GitHub before installing. PR CI normally tests GitHub's synthetic merge ref, not only the feature branch commit. Record the run URL and smoke-test results in the PR. `try-ci-vsix.sh` downloads that run's VSIX, installs it into isolated user-data/extensions directories under `~/.vscode-bnd-ci/run-<run-id>`, and opens the sample workspace. It prints run identity and installed version. Use an explicit successful run ID to avoid accidentally testing an older artifact; the helper does not enforce success for an explicit ID.

Run the smoke-test matrix below plus checks for the changed behavior. Confirm the installed extension identity/version and **Output** > **bnd Language Server** startup. Clean profiles do not include Red Hat Java or Debugger for Java: install those separately in the isolated profile when testing Java import or debugging. Check workspace settings for old `bnd.server.jar` overrides so Java tests exercise the packaged JAR. Avoid `--main-profile`, which modifies the regular installation, and `--copy-settings`, which can reintroduce local overrides. `--keep` reuses a run's profile; by default the helper recreates it, so close that test window before running it again.

If CI fails, use `gh run view "$RUN_ID" --log-failed`, fix the feature branch, rerun local validation, commit and push. Repeat CI and artifact testing for the new revision. Do not merge on an older green run.

### Step 3: Merge and Validate Main

Merge only after required reviews, current PR checks, and artifact testing pass. Use the repository's allowed merge method; for squash merging:

```bash
gh pr merge --squash --delete-branch
git switch main
git pull --ff-only origin main
gh run list --workflow ci.yml --branch main --event push --commit "$(git rev-parse HEAD)" --limit 5
# Select the push run for this exact main commit.
MAIN_RUN_ID=1234567891
gh run watch "$MAIN_RUN_ID" --exit-status
gh run view "$MAIN_RUN_ID" --json headSha,event,conclusion,url
bash scripts/try-ci-vsix.sh "$MAIN_RUN_ID" ../../klibio/example.bnd.rcp
```

Repeat the relevant packaged smoke tests on this main artifact. Merge/squash produces a different commit from the PR head; a green PR run does not replace this gate. Pushing or merging to `main` runs CI but does **not** publish to Marketplace. If main validation fails, fix through a new PR and do not tag the failing commit.

### Step 4: Tag the Validated Commit and Publish

Confirm a clean worktree, the expected main commit, matching versions in both package files, and correct changelog. The version must be new on Marketplace. If another change lands on main, either repeat validation for it or tag the previously validated main commit explicitly.

```bash
git status --short
git log -1 --oneline
VERSION="$(node -p "require('./package.json').version")"
node -e "const p=require('./package.json'),l=require('./package-lock.json'); if(p.version!==l.version || p.version!==l.packages[''].version) process.exit(1)"
git tag -a "v$VERSION" -m "Release v$VERSION" HEAD
git push origin "v$VERSION"
gh run list --workflow release.yml --limit 5
# Select the Release run for this tag and commit.
RELEASE_RUN_ID=1234567892
gh run watch "$RELEASE_RUN_ID" --exit-status
gh release view "v$VERSION"
```

Stop if any check fails. Push only the intended tag, not `--tags`. Do not move an already published tag.

`.github/workflows/release.yml` triggers on `v*.*.*` tags. It requires the tagged commit to be an ancestor of the repository's default branch (currently `main`), installs dependencies, compiles, packages a fresh VSIX, creates/updates a GitHub Release with generated notes and the VSIX asset, then publishes that package to publisher **`klibio`** (extension **`klibio.bnd`**) if Actions secret `VSCE_PAT` is nonempty. Configure that secret through GitHub repository settings, never in source files.

Important limits: Release does **not** run `npm test`, require successful CI, or check that tag text matches `package.json`. These are manual gates above. Its branch check accepts any ancestor of default-branch history, not only the current tip. A green Release run can mean **GitHub-only release**: if `VSCE_PAT` is absent, Marketplace publishing is skipped. Inspect the publish step and Marketplace version before calling the release complete. Release rebuilds the VSIX; it does not promote the byte-identical CI artifact.

### Step 5: Retry or Publish Manually

For an existing release tag on main, **Actions** > **Release** > **Run workflow** accepts `tag` and `publish`. The default `publish: false` creates/updates the GitHub Release only. Enable publishing only when the version has not already been published:

```bash
gh workflow run release.yml --ref main -f tag="v$VERSION" -f publish=false
# Only when Marketplace publication is still needed and VSCE_PAT is configured:
gh workflow run release.yml --ref main -f tag="v$VERSION" -f publish=true
```

A rerun rebuilds the package and replaces the GitHub asset; it does not guarantee identical bytes. If GitHub release creation succeeds but Marketplace publishing fails, inspect that step's error and verify whether the version exists in Marketplace before retrying. An already published version cannot be overwritten; ship a new version through the normal PR process instead.

Manual fallback: upload the verified release VSIX through the [Marketplace Management Portal](https://marketplace.visualstudio.com/manage) under publisher `klibio`. Alternatively, with `VSCE_PAT` securely supplied in the environment, run `npx @vscode/vsce publish --packagePath "bnd-$VERSION.vsix"`. This publishes the selected package rather than rebuilding the working tree. `npm run publish` rebuilds/publishes the current checkout; it is not the normal release path. The separate `package:prerelease`/`publish:prerelease` scripts target the Marketplace pre-release channel; current Release automation does not use that channel. Open VSX publication is separate and is not automated here.

---

## 7. Testing Published Version

### Step 1: Install from Marketplace

First inspect the Release run's **Publish to VS Code Marketplace** step and confirm the expected version on the [klibio.bnd Marketplace page](https://marketplace.visualstudio.com/items?itemName=klibio.bnd). Marketplace availability can lag upload completion; do not use a cached older install as release proof.

1. Open standard VS Code (clean profile recommended).
2. Install extension via CLI:
   ```bash
   code --install-extension klibio.bnd --force
   ```
   Or search `bnd` / `klibio` in Extensions view (`Ctrl+Shift+X`) and click **Install**.

### Step 2: Clean Profile Verification

To test without interference from previous configuration:

```bash
# Use a new directory for each verification, with no development extension loaded.
RELEASE_TEST_DIR="$(mktemp -d)"
code --user-data-dir "$RELEASE_TEST_DIR/user-data" --extensions-dir "$RELEASE_TEST_DIR/extensions" --install-extension klibio.bnd --force
code --user-data-dir "$RELEASE_TEST_DIR/user-data" --extensions-dir "$RELEASE_TEST_DIR/extensions" --list-extensions --show-versions
code --user-data-dir "$RELEASE_TEST_DIR/user-data" --extensions-dir "$RELEASE_TEST_DIR/extensions" --new-window ../../klibio/example.bnd.rcp
```

Confirm `klibio.bnd@<expected-version>` in the listing, then perform the smoke tests below. Compare the GitHub release asset version as well. Record tag, commit, CI/Release run URLs, installed Marketplace version, and smoke-test results in the PR or release notes. Close the test window before removing its temporary directory.

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
