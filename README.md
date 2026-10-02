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

Use **Bnd: Open Effective** on a `.bnd` or `.bndrun` file, or select **Bnd Effective** from **Reopen Editor With...**. **Bnd: Open Effective to Side** keeps the source editor visible beside the read-only table. The standard text editor remains the default.

The table shows **Key**, **Value**, **Provenance**, and evaluation **Errors**. Filter rows, resize columns, expand long values, and click provenance links to open defining files. **Expanded** evaluates macros; **Merged** combines supported instructions and headers using bnd's decorated-property semantics. Turning expansion off also disables merging.

Current-file edits appear without saving, including added and deleted properties. Included files and workspace settings use their saved contents; a warning identifies unsaved dependencies. Saving dependencies or using **Refresh** recomputes the view. **Show Effective Source** opens generated read-only bnd text; **Open Original Source** returns to the editable file.

This feature requires workspace trust and a Java language server advertising `bnd.properties.effective`. The bundled server supports it; Node fallback and older custom/socket servers report that it is unavailable. Macro evaluation is not a sandbox: trusted bnd configuration can initialize plugins, create caches, access repositories, or run commands. Effective values can contain secrets; copying or exporting them should be deliberate.

### Run and Debug

`.bndrun` files and bnd projects launch through VS Code's **Run and Debug** facility. The Java language server prepares the launch with bnd's `ProjectLauncher` (`bnd.launch.prepare`), and the [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) extension starts the JVM, so breakpoints, stepping, and the Debug Console work as usual. When the session ends, the extension calls `bnd.launch.dispose` to delete temporary launcher files.

- **Run OSGi** / **Debug OSGi** and **Run OSGi tests** / **Debug OSGi tests** CodeLens on `.bndrun` and `bnd.bnd` files (`bnd.launch.codeLens`), the editor title run menu, the Explorer context menu, and the Command Palette.
- A `bnd` debug type for `launch.json` with `target`, `kind` (`run` or `test`), `tests`, `vmArgs`, `args`, `env`, `console`, `buildBeforeLaunch`, `javaExec`, and `shortenCommandLine`. The Run and Debug view lists every `.bndrun` file and test project dynamically.
- The Java runtime defaults to the bnd `java` property, then a runtime matching `-runee`. `-runjdb` is ignored because the Java debugger owns the JDWP connection.

Launching requires workspace trust, the Java language server (the Node fallback cannot launch), and Debugger for Java. See [walkthroughs/06-launch-debug.md](walkthroughs/06-launch-debug.md) for details.

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

**Architecture:**

```
VS Code (Extension Host)                Language Server (runtime-selected)
─────────────────────────               ────────────────────────────────
src/extension.ts  ←── IPC ───►  Java JAR / Node / Socket server
  (starts and restarts the server,      (completion, hover,
   registers LSP commands)              diagnostics and command handlers)
```

## Integrated bnd CLI Commands

All commands are available in the **Command Palette** (`Ctrl+Shift+P`) under the `Bnd:` prefix.

| Command | Description |
|---|---|
| `Bnd: Build Project` | `bnd build` — build with mode selection (normal / test / watch) |
| `Bnd: Run` | `bnd run` — pick a `.bndrun` file or use the current project |
| `Bnd: Test Project` | `bnd test` |
| `Bnd: Run OSGi Tests` | `bnd runtests` |
| `Bnd: Resolve (.bndrun)` | `bnd resolve` — multi-select `.bndrun` files |
| `Bnd: Clean Project` | `bnd clean` |
| `Bnd: Baseline Check` | `bnd baseline` |
| `Bnd: Verify JARs` | `bnd verify` — pick generated JARs |
| `Bnd: Print Bundle Info` | `bnd print` — choose view mode and JAR |
| `Bnd: Diff Bundles` | `bnd diff` — prompts for newer + older JAR |
| `Bnd: Wrap JAR as OSGi Bundle` | `bnd wrap` |
| `Bnd: Export (.bndrun)` | `bnd export` |
| `Bnd: Release Project` | `bnd release` (with confirmation) |
| `Bnd: Show Project Properties` | `bnd properties` |
| `Bnd: Show Project Info` | `bnd info` |
| `Bnd: Show bnd Version` | `bnd version` |
| `Bnd: Evaluate Macro Expression` | `bnd macro` — enter a macro expression interactively |
| `Bnd: Repository Commands` | `bnd repo` sub-command picker |
| `Bnd: Download Latest bnd CLI JAR` | Downloads the latest `biz.aQute.bnd:biz.aQute.bnd` from Maven Central or a configured mirror into the extension tool folder and sets `bnd.cli.executable` automatically |
| `Bnd: Download bnd CLI JAR Version...` | Lets you choose an older available bnd version on demand and configures `bnd.cli.executable` to use it |
| `Bnd: Select Java Runtime for bnd CLI` | Selects one of the runtimes from `java.configuration.runtimes` and uses its `bin/java` for bnd JAR execution |
| `Bnd: Discover Java Runtimes from Folder...` | Recursively scans a root folder for Java runtimes and adds found runtimes to `java.configuration.runtimes` |
| `Bnd: Show CLI Reference` | Opens a searchable webview panel with all 77 bnd CLI commands |

All commands run in VS Code's integrated terminal named **"bnd"**.

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

Run **Bnd: Select Language Server JAR...** to choose the JAR used in `java` mode:

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

You can run **Bnd: Download Latest bnd CLI JAR** to download and configure the newest available release immediately. If you need an older version such as `7.2.3`, run **Bnd: Download bnd CLI JAR Version...** and select one of the available versions or enter one explicitly. Both commands store the JAR in the extension's `library/tool` storage folder and update `bnd.cli.executable` to `java -jar ...` automatically.

To choose a specific Java runtime for `java -jar`, run **Bnd: Select Java Runtime for bnd CLI**. This reads from VS Code's `java.configuration.runtimes` and updates `bnd.cli.javaExecutable`.

If your Java runtime is not yet listed, run **Bnd: Discover Java Runtimes from Folder...**. The selected root folder is searched recursively, and discovered runtimes are appended to `java.configuration.runtimes`.

If you need to use a Central-compatible mirror instead of Maven Central, set `bnd.cli.mavenRepository` first, for example:

```jsonc
{
  "bnd.cli.mavenRepository": "https://repo1.maven.org/maven2",
  "bnd.cli.javaExecutable": "java"
}
```

### CLI Reference Panel

Run **Bnd: Show CLI Reference** (`Ctrl+Shift+P → Bnd: Show CLI Reference`) to open a searchable panel
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
