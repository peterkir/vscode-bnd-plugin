---
title: Configuration reference
layout: default
permalink: /reference/
description: All settings, commands, keyboard shortcuts, status bar items, and output channels of the bnd / bndtools extension.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

Open settings with <kbd>Ctrl</kbd>+<kbd>,</kbd> and search for `bnd`, or edit `settings.json`. Settings marked **machine** can only be set in User settings or remote machine settings, not in a workspace.

## Settings

### Language server

| Setting | Default | Description |
|---|---|---|
| `bnd.server.enabled` | `true` | Start the bnd language server. When `false`, no server process runs; see [Status and disabling the server]({{ '/language-server/#status-and-disabling-the-server' | relative_url }}). |
| `bnd.server.mode` | `java` | `java` (full bndlib server), `node` (lightweight TypeScript server), or `socket` (connect to an existing server). |
| `bnd.server.jar` | `""` | Local `biz.aQute.bnd.lsp.jar`. Takes precedence over `jarSource`. Started from a copy so it can be rebuilt. |
| `bnd.server.jarSource` | `bundled` | `bundled`, `release`, `snapshot`, or `url`. **Machine.** |
| `bnd.server.jarVersion` | `latest` | Version for `release` or `snapshot`, for example `7.5.0` or `7.5.0-SNAPSHOT`. `latest` checks on every start. **Machine.** |
| `bnd.server.jarUrl` | `""` | https URL for the `url` source. **Machine.** |
| `bnd.server.jarSha256` | `""` | Optional SHA-256 of the JAR at `jarUrl`. The download is rejected on mismatch. **Machine.** |
| `bnd.server.javaExecutable` | `""` | Java executable for the server. Empty uses `JAVA_HOME` or the `java` on `PATH`. |
| `bnd.server.jvmArgs` | `[]` | Additional JVM arguments for the Java server. |
| `bnd.server.socketPort` | `5007` | TCP port for `socket` mode. |

### Build and workspace

| Setting | Default | Description |
|---|---|---|
| `bnd.build.auto` | `true` | Build bnd projects automatically and incrementally. Requires a trusted workspace and a server with automatic build support. See [Automatic build]({{ '/language-server/#automatic-build' | relative_url }}). |
| `bnd.explorer.exclude` | `[".git", "node_modules"]` | Exact file and folder names hidden at every level of the bnd Explorer. No glob patterns. |
| `bnd.eclipse.detect` | `true` | Detect an Eclipse instance that has the workspace open and show it in the status bar. See [Parallel use with Eclipse]({{ '/eclipse/' | relative_url }}). |
| `bnd.launch.codeLens` | `true` | Show Run and Debug CodeLens at the top of `.bndrun` and `bnd.bnd` files. |

### bnd CLI

| Setting | Default | Description |
|---|---|---|
| `bnd.cli.executable` | `bnd` | Command used to invoke the bnd CLI, for example `bnd` or `java -jar /path/to/biz.aQute.bnd.jar`. Managed by the extension unless you set it yourself. |
| `bnd.cli.javaExecutable` | `java` | Java executable used when bnd runs as `java -jar`. |
| `bnd.cli.mavenRepository` | `https://repo.maven.apache.org/maven2` | Base URL for downloading bnd release JARs. Use a Central-compatible mirror if needed. |
| `bnd.cli.snapshotRepository` | `https://bndtools.jfrog.io/artifactory/libs-snapshot-local` | Base URL for downloading bnd snapshot JARs. |
| `bnd.cli.showCommands` | `false` | Initial visibility of `bnd-cli:` commands in the Command Palette. The toggle command stores its own choice afterwards. Application scope. |

### Workspace wizards

| Setting | Default | Description |
|---|---|---|
| `bnd.wizard.workspaceTemplateIndexes` | `["https://github.com/bndtools/bndtools.workspace.min"]` | Templates for **Create New Workspace From Template**: GitHub repository URLs, ZIP archives, or `.bnd` catalogs. |
| `bnd.wizard.fragmentTemplateIndexes` | `["https://raw.githubusercontent.com/bndtools/workspace-templates/master/index.bnd"]` | HTTP(S) or `file:` index URLs for **Add Fragment to (New) Workspace**. |
| `bnd.wizard.templateIndexes` | upstream fragment index | Deprecated. Fallback for the fragment catalog only. |

Only configure trusted template sources.

## Commands

All commands are available in the Command Palette. Language server, view, and wizard commands use the prefix **bnd:**; CLI commands use **bnd-cli:**.

### Language server and build

| Command | Description |
|---|---|
| bnd: Restart Language Server | Restart the server. |
| bnd: Enable/Disable Language Server | Toggle `bnd.server.enabled`. |
| bnd: Language Server Status... | Menu with enable/disable, restart, and output. |
| bnd: Select Language Server JAR... | Choose bundled, release, snapshot, URL, or local JAR. |
| bnd: Build Project (LSP) / Clean Project (LSP) / Baseline Project (LSP) | Build, clean, or baseline without the CLI. |
| bnd: Resolve Runbundles (LSP) | Dry-run resolve of a `.bndrun`. |
| bnd: Export Run (LSP)... | Export an executable JAR or a run bundles folder. |
| bnd: Evaluate Macro (LSP) | Evaluate a macro expression. |
| bnd: Toggle / Enable / Disable Automatic Build | Switch `bnd.build.auto`. |
| bnd: Show Build Output | Open the **bnd Build** output channel. |

### Editor, views, and wizards

| Command | Description |
|---|---|
| bnd: Open Effective / Open Effective to Side | Show the Effective properties table. |
| bnd: Open Original Source / Show Effective Source | Switch between the editable file and generated effective text. |
| bnd: Open with bnd JAR Viewer | Open a JAR in the viewer. |
| bnd: Run OSGi Framework / Debug OSGi Framework | Launch the active or a chosen `.bndrun` or `bnd.bnd`. |
| bnd: Run OSGi Tests (Launch) / Debug OSGi Tests | Launch OSGi tests. |
| bnd: Create New Workspace From Template... | Workspace wizard. |
| bnd: Add Fragment to (New) Workspace... | Fragment wizard. |
| bnd: Import Existing Workspace... | Open or add an existing workspace. |
| bnd: Add Workspace Template URL... / Add Fragment Template URL... | Register a template source. |
| bnd: Refresh Repositories, Filter Repositories..., Clear Repository Filter, Advanced Search..., Clear Advanced Search, Work Offline, Work Online | Repositories view toolbar actions. |
| bnd: Download Repository Content, Add Bundles to Repository..., Repository Actions... | Repository node actions. |
| bnd: Copy Bundle Symbolic Name, Copy Version, Copy as bnd Entry, Reveal JAR File, Open in bnd JAR Viewer, Show Manifest | Bundle and version node actions. |
| bnd: Add Resource to Resolution View..., Refresh Resolution View, Clear Resolution View, Analyze in Resolution View | Resolution view actions. |
| bnd: Refresh Workspace Files, Reveal in Explorer View | bnd Explorer actions. |

### Eclipse

| Command | Description |
|---|---|
| bnd: Eclipse Parallel Use... | Menu of Eclipse-related actions. |
| bnd: Configure Parallel Use with Eclipse... | Create or remove `cnf/ext/vscode-outputs.bnd`. |

### bnd CLI

See the [command table]({{ '/cli/#commands' | relative_url }}). The prefix is **bnd-cli:**.

## Keyboard shortcuts

The bnd Explorer uses the keys of the built-in Explorer while it has focus.

| Key | Action |
|---|---|
| <kbd>F2</kbd> | Rename |
| <kbd>Delete</kbd> | Delete (to Recycle Bin or Trash) |
| <kbd>Ctrl</kbd>+<kbd>X</kbd> / <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd> | Cut / Copy / Paste |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Open to the Side |
| <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> | Copy Path |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> | Copy Relative Path |
| <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> | Reveal in File Explorer |

Other useful shortcuts in bnd files: <kbd>Ctrl</kbd>+<kbd>Space</kbd> (completion), <kbd>Ctrl</kbd>+<kbd>.</kbd> (quick fix), <kbd>F5</kbd> (launch a `.bndrun` or `bnd.bnd` when no `launch.json` exists).

On macOS use <kbd>Cmd</kbd> instead of <kbd>Ctrl</kbd> where VS Code does.

## Status bar items

| Item | Shows |
|---|---|
| **bnd LS** | Language server state and mode. Click for the status menu. |
| **bnd: auto-build** | Automatic build state. Click to toggle. |
| **Eclipse** | An Eclipse instance has the workspace open. Click for the parallel-use menu. |

## Output channels

| Channel | Content |
|---|---|
| **bnd Language Server** | Server log, baseline reports, export results, `System.out` of workspace plugins, parallel-use reports. |
| **bnd Build** | Completed automatic builds with errors and warnings per project. |

## Debug configuration

The `bnd` debug type is described in [Run and Debug]({{ '/run-debug/#launchjson' | relative_url }}).

## Activation and file types

The extension activates for `.bnd`, `.bndrun`, and `.mvn` files, for workspaces that contain `cnf/build.bnd`, and for the `bnd-jar` file system used by the JAR Viewer.
