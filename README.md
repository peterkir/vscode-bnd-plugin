# bnd / bndtools for VS Code

A Visual Studio Code extension providing rich language support for **bnd** (`.bnd`) and **bndrun** (`.bndrun`) files used in [OSGi](https://www.osgi.org/) development with the [bnd/bndtools](https://bnd.bndtools.org) toolchain.

## Features

### Syntax Highlighting

Full TextMate grammar covering:

- **Instructions** – Lines starting with `-keyword:` (e.g., `-buildpath:`, `-runbundles:`, `-privatepackage:`) highlighted as control keywords.
- **OSGi Headers** – Standard manifest headers (`Bundle-SymbolicName:`, `Export-Package:`, `Import-Package:`, etc.) highlighted as storage types.
- **Properties** – Lowercase key-value properties highlighted as variables.
- **Macros** – `${macroname}` expressions, with the macro name highlighted as a function. Nested macros are also handled.
- **Version ranges** – `[1.0,2.0)` and `(1.0,2.0]` highlighted as numeric constants.
- **String literals** – Single and double-quoted strings.
- **Directives** – `key:=value` attribute/directive syntax.
- **Continuation lines** – Trailing backslash `\` line continuations.
- **Comments** – `#` line comments and `//` inline comments.

### IntelliSense Completions

Trigger completions with `Ctrl+Space` (or automatically on `-`, `$`, `{`, `:`).
All completion items are pre-filled with **real examples from the bnd documentation**.

- **153 bnd instructions** – e.g.:
  - `-buildpath: osgi;version=4.1`
  - `-runbundles: org.apache.felix.framework;version='[7,8)'`
  - `-dsannotations: *`, `-runee: JavaSE-17`, `-standalone: ...`
- **138 bnd macros** – triggered when the cursor is inside `${...}`:
  - `${bsn}`, `${version}`, `${range;[==,+);${@}}`, `${repo;bsns}`
  - `${filter;<list>;<regex>}`, `${replace;<list>;<regex>;<replacement>}`
  - `${tstamp;yyyy-MM-dd}`, `${githead}`, `${system;git describe}`
- **48 OSGi headers and bnd pseudo-headers** – e.g.:
  - `Bundle-SymbolicName: com.example.bundle`
  - `Export-Package: com.example.api;version=1.0`
  - `Require-Capability: osgi.identity; filter:='...'`

### Hover Documentation

Hover over any instruction keyword, OSGi header, or macro name to see:
- The full syntax signature (bold).
- A documentation summary from the bnd reference docs.
- An **example** from the official bnd documentation, shown in a `bnd` code block.

### Effective Properties

Use **bnd: Open Effective** on a `.bnd` or `.bndrun` file, or select **Bnd Effective** from **Reopen Editor With...**. **bnd: Open Effective to Side** keeps the source editor visible beside the read-only table. The standard text editor remains the default.

The table shows **Key**, **Value**, **Provenance**, and evaluation **Errors**. Filter rows, resize columns, expand long values, and click provenance links to open defining files. **Expanded** evaluates macros; **Merged** combines supported instructions and headers using bnd's decorated-property semantics. Turning expansion off also disables merging.

Current-file edits appear without saving, including added and deleted properties. Included files and workspace settings use their saved contents; a warning identifies unsaved dependencies. Saving dependencies or using **Refresh** recomputes the view. **Show Effective Source** opens generated read-only bnd text; **Open Original Source** returns to the editable file.

This feature requires workspace trust and a Java language server advertising `bnd.properties.effective`. The bundled server supports it; Node fallback and older custom/socket servers report that it is unavailable. Macro evaluation is not a sandbox: trusted bnd configuration can initialize plugins, create caches, access repositories, or run commands. Effective values can contain secrets; copying or exporting them should be deliberate.

### Run and Debug

`.bndrun` files and bnd projects launch through VS Code's **Run and Debug** facility. The Java language server prepares the launch with bnd's `ProjectLauncher` (`bnd.launch.prepare`), and the [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) extension starts the JVM, so breakpoints, stepping, and the Debug Console work as usual. When the session ends, the extension calls `bnd.launch.dispose` to delete temporary launcher files. A run without debugging in a terminal keeps its launcher files until the same target is launched again or the language server shuts down, because the JVM reads them after the session ends.

- **Run OSGi** / **Debug OSGi** and **Run OSGi tests** / **Debug OSGi tests** CodeLens on `.bndrun` and `bnd.bnd` files (`bnd.launch.codeLens`), the editor title run menu, the context menu in the Explorer and bnd Explorer, and the Command Palette. From the Command Palette without an active `.bndrun` or `bnd.bnd` editor, a list of the workspace's launch files is shown.
- A `bnd` debug type for `launch.json` with `target`, `kind` (`run` or `test`), `tests`, `vmArgs`, `args`, `env`, `console`, `buildBeforeLaunch`, `javaExec`, and `shortenCommandLine`. The Run and Debug view lists every `.bndrun` file and test project dynamically.
- The Java runtime defaults to the bnd `java` property, then a runtime matching `-runee`. `-runjdb` is ignored because the Java debugger owns the JDWP connection.

Launching requires workspace trust, the Java language server (the Node fallback cannot launch), and Debugger for Java. See [walkthroughs/06-launch-debug.md](walkthroughs/06-launch-debug.md) for details.

### Repositories View

The **bnd** Activity Bar container shows an independent **Explorer** above **Repositories** by default. It offers the built-in Explorer's file actions in the same context-menu groups and with the same default keys: New File/Folder, Open to the Side, Open With, Reveal in File Explorer, Open in Integrated Terminal, Find in Folder, Cut/Copy/Paste (copies get `name copy.ext`), Copy Path/Relative Path, Rename (`F2`), Delete (to the Recycle Bin/Trash), and compare. Dragging moves files within the tree; files dropped from outside are copied. bnd actions (Run/Debug, Open Effective, JAR Viewer, Resolution) appear on matching files. Configure `bnd.explorer.exclude` with exact file/folder names to hide at every level (default `.git` and `node_modules`); it does not use the normal Explorer's `files.exclude`. Context-menu entries that other extensions add to the built-in Explorer are not available here; use **Reveal in Explorer View** for them. VS Code preserves any view order you customize.

The **Repositories** view is a port of the bndtools Eclipse view. It lists one root per bnd workspace (a folder with `cnf/build.bnd`). Each root shows the Workspace repository, with projects and their bundles, followed by the configured repository plugins. Expand repositories to see bundles, versions, and, for P2 repositories, features with their included and required items.

- **Filter** matches bundle symbolic names (`*` and `?` wildcards; the text is matched anywhere in the name).
- **Advanced Search** finds providers of a package (with an optional version range), a service, or any namespace and LDAP filter in repositories that implement the OSGi Repository API.
- **Refresh**, **Collapse All**, and **Work Offline** / **Work Online** in the view title.
- **Add Bundles to Repository...** on writable repositories, or drop JAR files from the Explorer onto them. **Download Repository Content** fetches remote repositories, bundles, or versions into the local cache.
- Activating a bundle opens its newest JAR in the bnd JAR Viewer; activating a version opens that exact JAR. The version context menu also offers **Reveal JAR File** and **Show Manifest**. **Copy Bundle Symbolic Name**, **Copy Version**, and **Copy as bnd Entry** (`bsn;version='1.2.3'`) are available on bundle and version nodes.
- **Repository Actions...** runs actions contributed by repository plugins (the bnd `Actionable` interface).
- Drag bundles or versions into a bnd editor to insert `bsn;version=...` entries for `-buildpath`, `-runbundles`, and similar instructions.

The view requires workspace trust and the Java language server, because repository plugins run workspace code. See [walkthroughs/07-repositories.md](walkthroughs/07-repositories.md).

### Resolution View

**Resolution** appears as a tab in VS Code's bottom Panel beside Terminal, Problems, and Debug Console. Add `.bnd` files, JARs, or a version from the Repositories view to compare their OSGi requirements and capabilities. Requirements are marked matched when a selected resource provides a matching capability.

Selecting bundles or versions in Repositories replaces the analyzed resources with that selection; bundles use their newest available version. Dragging repository entries or local `.bnd`/`.jar` files into Resolution adds them to the existing selection. The resource list is saved per VS Code workspace.

This is capability matching, not a full OSGi resolver: a matched requirement does not prove that a framework can resolve or launch. Analysis reads saved files and accepts at most 100 resources. For `bnd.bnd` projects with sub-bundles, only the first sub-builder is analyzed; select individual sub-bundle `.bnd` files or their generated JARs to compare the others. `.bndrun` files are not accepted; use **bnd-cli: Resolve (.bndrun)** for runbundle resolution.

Filter both lists with space-separated terms and `*` / `?` wildcards. Hide optional requirements or show unresolved requirements only. Select a row to copy its attributes, directives, and source. The analysis requires a trusted workspace and an updated Java bnd Language Server; the Node fallback does not provide resource analysis.

### JAR Viewer

`.jar` files open in the **bnd JAR Viewer**, a port of the bndtools Eclipse JAR editor. Use **Open with bnd JAR Viewer** in the Explorer or bnd Explorer context menu, or **Reopen Editor With...** to switch between it and other editors.

- **Tree** lists the archive entries and initially selects `feature.xml` or `META-INF/MANIFEST.MF`. The selected entry shows its size and last-modified time. **Show As** chooses **Auto** (hex when the content contains a zero byte, otherwise text), **Text** with a selectable encoding, or **Binary (hex)**. **Limit** reads at most 1,000,000 bytes. Double-click an entry, or press Enter, to open it read-only in a normal editor.
- **Print** shows the full `bnd print` report (manifest, imports and exports, capabilities, components, metatype, API and uses, and the entry list). It requires the Java language server; Node fallback and older servers report that it is unavailable. Use `Ctrl+F` to search the report.

The viewer reflects changes to the JAR file and closes when the file is deleted. It never modifies the JAR.

### Native Java Project Import

The extension contributes a headless bnd adapter to Language Support for Java (`redhat.java`). It requires JDT LS 1.61 or later (Red Hat Java 1.56 or later), running on Java 21 or later. In a bnd workspace, it imports Java projects ahead of Gradle: source/test roots, separate output directories, `-buildpath`, `-testpath`, compiler settings and JRE containers. Changes to `.bnd` and `.mvn` configuration refresh the classpath.

The adapter owns imported bnd Java project metadata; do not have Gradle/Buildship manage the same projects in the same Java language-server workspace. After upgrading, run **Java: Clean Java Language Server Workspace** and allow reimport to remove stale unmanaged source roots. Use valid names in `java.configuration.runtimes`, such as `JavaSE-21` and `JavaSE-25`, not folder names such as `JAVA21`. Source and output directories must currently be inside their project directory.

To request a classpath refresh without clearing the Java workspace, run **Java: Reload Projects** (`java.projectConfiguration.update` in Red Hat Java 1.56). Automatic updates also depend on `java.configuration.updateBuildConfiguration`; use `automatic` for unattended refreshes or approve updates when it is `interactive`.

### Language Server Protocol (LSP)

This extension implements the [Language Server Protocol](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide).
The language server can be started in three modes:

- `java` mode: launches `biz.aQute.bnd.lsp.jar` (bundled, downloaded, or local; see below) with the configured Java executable
- `node` mode: runs the TypeScript LSP directly inside the extension host
- `socket` mode: connects to an already running TCP-based language server on `127.0.0.1:<port>`

This means:

- the server can run in the mode that best matches your environment
- the extension falls back cleanly if the bundled LSP JAR is missing
- the LSP remains available for editors that can speak the protocol

`bnd: Resolve Runbundles (LSP)` resolves the active or selected `.bndrun` file through a Java language server and reports resolution errors. For Node mode, use `bnd-cli: Resolve (.bndrun)` instead.

**Architecture:**

```
VS Code (Extension Host)                Language Server (runtime-selected)
─────────────────────────               ────────────────────────────────
src/extension.ts  ←── IPC ───►  Java JAR / Node / Socket server
  (starts and restarts the server,      (completion, hover,
   registers LSP commands)              diagnostics and command handlers)
```

## Integrated bnd CLI Commands

CLI commands use the `bnd-cli:` prefix in the **Command Palette** (`Ctrl+Shift+P`). Language-server and other extension actions use `bnd:`.

CLI palette entries are hidden by default. Run **bnd-cli: Toggle CLI Commands in Command Palette** to show or hide them. This command always remains visible. The preference is saved in the extension's global storage, applies across workspaces in the current VS Code profile, and survives restarts. No User settings file is modified, so settings errors do not block the toggle. Before the first toggle, User setting `bnd.cli.showCommands` supplies the initial value (default `false`); afterward, the stored toggle choice takes precedence. Existing saved choices are preserved. This affects only palette visibility, not command execution or context menus.

| Command | Description |
|---|---|
| `bnd-cli: Build Project` | `bnd build` — build with mode selection (normal / test / watch) |
| `bnd-cli: Run` | `bnd run` — pick a `.bndrun` file or use the current project |
| `bnd-cli: Test Project` | `bnd test` |
| `bnd-cli: Run OSGi Tests` | `bnd runtests` |
| `bnd-cli: Resolve (.bndrun)` | `bnd resolve resolve -W` — multi-select `.bndrun` files |
| `bnd-cli: Clean Project` | `bnd clean` |
| `bnd-cli: Baseline Check` | `bnd baseline` |
| `bnd-cli: Verify JARs` | `bnd verify` — pick generated JARs |
| `bnd-cli: Print Bundle Info` | `bnd print` — choose view mode and JAR |
| `bnd-cli: Diff Bundles` | `bnd diff` — prompts for newer + older JAR |
| `bnd-cli: Wrap JAR as OSGi Bundle` | `bnd wrap` |
| `bnd-cli: Export (.bndrun)` | `bnd export` |
| `bnd-cli: Release Project` | `bnd release` (with confirmation) |
| `bnd-cli: Show Project Properties` | `bnd properties` |
| `bnd-cli: Show Project Info` | `bnd info` |
| `bnd-cli: Show bnd Version` | `bnd version` |
| `bnd-cli: Evaluate Macro Expression` | `bnd macro` — enter a macro expression interactively |
| `bnd-cli: Repository Commands` | `bnd repo` sub-command picker |
| `bnd-cli: Configure bnd Library...` | Selects a release, snapshot, or custom https JAR and configures `bnd.cli.executable` |
| `bnd-cli: Select Java Runtime for bnd CLI` | Selects one of the runtimes from `java.configuration.runtimes` and uses its `bin/java` for bnd JAR execution |
| `bnd-cli: Discover Java Runtimes from Folder...` | Recursively scans a root folder for Java runtimes and adds found runtimes to `java.configuration.runtimes` |
| `bnd-cli: Show CLI Reference` | Opens a searchable webview panel with all 77 bnd CLI commands |

CLI executions run in VS Code's integrated terminal named **"bnd"**. Configuration, reference, and palette visibility commands run inside the extension.

### Configuration

Set the `bnd.cli.executable` workspace or user setting to point to your bnd installation:

```jsonc
// settings.json
{
    // If bnd is on your PATH (e.g. brew install bnd):
    "bnd.cli.executable": "bnd",

    // Or run it as an executable JAR:
    "bnd.cli.executable": "java -jar /path/to/biz.aQute.bnd.jar"
}
```

For the embedded language server, configure the startup mode in `bnd.server.mode`:

```jsonc
{
  "bnd.server.mode": "java",
  "bnd.server.jar": "",
  "bnd.server.javaExecutable": "",
  "bnd.server.jvmArgs": [],
  "bnd.server.socketPort": 5007
}
```

- `java` starts `biz.aQute.bnd.lsp.jar` with the configured Java runtime.
- `node` starts the TypeScript language server directly.
- `socket` connects to an already running LSP on `127.0.0.1:5007`.
- If no JAR is present, the extension automatically warns and falls back to `node` mode.

#### Language server JAR selection

Run **bnd: Select Language Server JAR...** to choose the JAR used in `java` mode:

| Choice | Settings written (User) | Source |
|---|---|---|
| Bundled | `bnd.server.jarSource: bundled` | `server/biz.aQute.bnd.lsp.jar` shipped with the extension |
| Release | `jarSource: release`, `jarVersion` | `biz.aQute.bnd:biz.aQute.bnd.lsp` from `bnd.cli.mavenRepository` (Maven Central), verified against `.sha1` |
| Snapshot | `jarSource: snapshot`, `jarVersion` | `bnd.cli.snapshotRepository` (bndtools Artifactory), verified against `.sha1` |
| Custom URL | `jarSource: url`, `jarUrl`, optional `jarSha256` | Any https URL |
| Local file | `bnd.server.jar` | A local JAR, e.g. a build output |

- `bnd.server.jar` always wins; a configured but missing path produces a warning.
- `jarVersion: latest` checks for the newest release or snapshot on each language server start.
- Downloads are cached in the extension's global storage (`library/lsp`, newest three JARs kept). Startup never waits for the network: until a download is cached, the bundled JAR is used, and a notification offers a restart once a different JAR is ready.
- `jarSource`, `jarVersion`, `jarUrl`, and `jarSha256` are machine-scoped, so a workspace cannot redirect the server to a different JAR.
- `biz.aQute.bnd.lsp` is not yet published to Maven Central or the bndtools snapshot repository; until then, use Bundled, Custom URL, or Local file.

Run **bnd-cli: Configure bnd Library...** to select a release, snapshot, or custom https JAR. Downloaded JARs are stored in the extension's `library/tool` storage folder, and `bnd.cli.executable` is updated to `java -jar ...` automatically.

To choose a specific Java runtime for `java -jar`, run **bnd-cli: Select Java Runtime for bnd CLI**. This reads from VS Code's `java.configuration.runtimes` and updates `bnd.cli.javaExecutable`.

If your Java runtime is not yet listed, run **bnd-cli: Discover Java Runtimes from Folder...**. The selected root folder is searched recursively, and discovered runtimes are appended to `java.configuration.runtimes`.

If you need to use a Central-compatible mirror instead of Maven Central, set `bnd.cli.mavenRepository` first, for example:

```jsonc
{
  "bnd.cli.mavenRepository": "https://repo1.maven.org/maven2",
  "bnd.cli.javaExecutable": "java"
}
```

### CLI Reference Panel

Run **bnd-cli: Show CLI Reference** (`Ctrl+Shift+P → bnd-cli: Show CLI Reference`) to open a searchable panel
showing all 77 bnd CLI sub-commands with their full option lists and examples from the official docs.

![CLI Reference panel showing searchable command list]

## Installation

### From VSIX

1. Download `bnd-<version>.vsix` from [GitHub Releases](https://github.com/peterkir/vscode-bnd-plugin/releases), or build it.
2. In VS Code open the Extensions view (`Ctrl+Shift+X`).
3. Click the `...` menu → **Install from VSIX…** and select the file.

See [INSTALL.md](INSTALL.md) for full instructions including command-line install.

### Build from Source

```bash
cd vscode-bnd-plugin
npm install              # install client deps
npm install --prefix server  # install server deps
npm run compile:all      # compile client + server TypeScript
npm run compile:tests    # compile VS Code extension tests
npm test                 # run VS Code extension tests
npm run package          # downloads vsce on demand and builds the VSIX
# Produces bnd-<version>.vsix
```

### Upstream Java Repo Parity Tests

Some tests validate CLI command parity against bnd Java source in `biz.aQute.bnd/src/aQute/bnd/main/bnd.java`.

Set one of these environment variables before running `npm test`:

- `BND_SOURCE_REPO=<path-to-bnd-repo>`
- `BND_JAVA_REPO=<path-to-bnd-repo>`

If neither is set, tests also try sibling folder `../bnd`. If no source repo is found, parity checks are skipped.

## Usage

The extension activates automatically for any file with the `.bnd` or `.bndrun` extension.

### Example `bnd.bnd`

```properties
Bundle-SymbolicName: com.example.mybundle
Bundle-Version:      1.0.0

-buildpath: \
    osgi.core;version='[7,8)', \
    osgi.annotation;version='[8,9)'

Export-Package: com.example.api;version='${Bundle-Version}'
Private-Package: com.example.internal.*

-dsannotations: *
```

### Example `launch.bndrun`

```properties
-standalone: \
    https://repo.maven.apache.org/maven2/,index;name=central

-runfw: org.apache.felix.framework;version='[7,8)'
-runee: JavaSE-17

-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.example.mybundle)'

-runbundles: \
    com.example.mybundle;version='[1.0.0,1.0.1)'
```

## About

This extension is part of the [bnd/bndtools](https://github.com/bndtools/bnd) project.

- **bnd documentation**: <https://bnd.bndtools.org>
- **Issue tracker**: <https://github.com/bndtools/bnd/issues>

## License

This project is licensed under the **Eclipse Public License 2.0 (EPL-2.0)**.
See [LICENSE](LICENSE) for the full text.
