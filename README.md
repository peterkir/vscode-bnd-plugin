# Bnd and Bndrun Support for VS Code

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

This extension implements the [Language Server Protocol](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide).  
The language server runs in a **separate Node.js process**, which means:

- It will never block or crash VS Code's UI thread.
- The server can be reused by any LSP-compatible editor (Neovim, Emacs, Helix, …) with a small adapter.
- Adding new capabilities (diagnostics, formatting, go-to-definition) only requires changes in `server/src/server.ts`.

**Architecture:**

```
VS Code (Extension Host)                Language Server (separate process)
─────────────────────────               ────────────────────────────────
client/src/extension.ts  ←── IPC ───►  server/src/server.ts
  (starts the server,                     (completion, hover,
   registers the client)                   all LSP logic)
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

### CLI Reference Panel

Run **Bnd: Show CLI Reference** (`Ctrl+Shift+P → Bnd: Show CLI Reference`) to open a searchable panel
showing all 77 bnd CLI sub-commands with their full option lists and examples from the official docs.

![CLI Reference panel showing searchable command list]

## Installation

### From VSIX

1. Download or build `vscode-bnd-0.3.0.vsix`.
2. In VS Code open the Extensions view (`Ctrl+Shift+X`).
3. Click the `...` menu → **Install from VSIX…** and select the file.

See [INSTALL.md](INSTALL.md) for full instructions including command-line install.

### Build from Source

```bash
cd vscode-bnd
npm install              # install client deps
npm install --prefix server  # install server deps
npm run compile:all      # compile client + server TypeScript
npx @vscode/vsce package --allow-missing-repository --no-git-tag-version
# Produces vscode-bnd-0.3.0.vsix
```

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
