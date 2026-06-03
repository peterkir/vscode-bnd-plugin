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

### Language Server Protocol (LSP)

The extension uses a **Java-based language server** (`bnd-lsp`) that is automatically downloaded from [GitHub Releases](https://github.com/peterkir/vscode-bnd-plugin/releases) on first activation, cached locally, and launched via `java -jar`.

The server uses `aQute.bnd.help.Syntax` from `biz.aQute.bndlib` as its canonical data source — completion and hover data are always aligned with the bnd library version bundled in the JAR.

**Requirements:** Java 17 or newer must be on your `PATH` (or configured via `bnd.lsp.javaExecutable`).

**Where the JAR is cached:**

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\Code\User\globalStorage\bndtools.vscode-bnd\bnd-lsp.jar` |
| macOS | `~/Library/Application Support/Code/User/globalStorage/bndtools.vscode-bnd/bnd-lsp.jar` |
| Linux | `~/.config/Code/User/globalStorage/bndtools.vscode-bnd/bnd-lsp.jar` |

**Architecture:**

```
VS Code (Extension Host)                    Java Language Server (separate process)
────────────────────────                    ───────────────────────────────────────
src/extension.ts          ──── stdio ────►  bnd-lsp.jar
  src/bndLspDownloader.ts                     (Syntax.HELP from biz.aQute.bndlib)
```

#### LSP Configuration

| Setting | Default | Description |
|---|---|---|
| `bnd.lsp.javaExecutable` | `"java"` | Java executable to launch the server JAR. |
| `bnd.lsp.serverVersion` | `"latest"` | JAR version to download (`"latest"` or e.g. `"v0.1.0"`). |
| `bnd.lsp.downloadBaseUrl` | GitHub Releases URL | Base URL for downloading the JAR. |

**Pin a specific version:**

```jsonc
{
    "bnd.lsp.serverVersion": "v0.1.0"
}
```

**Use a specific Java runtime:**

```jsonc
{
    "bnd.lsp.javaExecutable": "/usr/lib/jvm/java-17/bin/java"
}
```

If the download fails, a notification is shown with **Retry** and **Show Output** options. Download progress and errors are logged to the **Bnd Language Server** output channel.

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

1. Download or build `vscode-bnd-<version>.vsix`.
2. In VS Code open the Extensions view (`Ctrl+Shift+X`).
3. Click the `...` menu → **Install from VSIX…** and select the file.

See [INSTALL.md](INSTALL.md) for full instructions including command-line install.

### Build from Source

```bash
cd vscode-bnd-plugin
npm install              # install extension dependencies
npm run compile:all      # compile TypeScript
npm run compile:tests    # compile VS Code extension tests
npm test                 # run VS Code extension tests
npm run package          # downloads vsce on demand and builds the VSIX
# Produces vscode-bnd-<version>.vsix
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
