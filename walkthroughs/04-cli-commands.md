# Integrated bnd CLI Commands

All bnd CLI commands are available directly from the VS Code Command Palette — no terminal required.

## Setting Up the bnd Executable

The extension downloads the latest bnd release on first activation and configures `bnd.cli.executable` for you.

Run **Bnd: Configure bnd Library...** to switch to another release, a snapshot build, or a JAR from your own https URL. The choice is stored in the workspace settings.

To use an existing installation instead, set `bnd.cli.executable` yourself (**Settings**, `Ctrl+,`):

| Installation method | Setting value |
|---|---|
| `bnd` on your PATH (e.g. `brew install bnd`) | `bnd` |
| Executable JAR | `java -jar /path/to/biz.aQute.bnd.jar` |

## Language Server Startup

The extension can start its language server in three modes:

| Mode | Purpose |
|---|---|
| `java` | Launch `biz.aQute.bnd.lsp.jar` using Java |
| `node` | Run the TypeScript language server directly |
| `socket` | Connect to an existing TCP LSP server |

The relevant settings are `bnd.server.mode`, `bnd.server.jar`, `bnd.server.jarSource`, `bnd.server.jarVersion`, `bnd.server.jarUrl`, `bnd.server.jarSha256`, `bnd.server.javaExecutable`, `bnd.server.jvmArgs`, and `bnd.server.socketPort`.

Run **Bnd: Select Language Server JAR...** to switch between the bundled JAR, a release, a snapshot, a custom https URL, or a local file.

If the bundled JAR is missing, the extension issues a warning and falls back to the Node server.

## Running a Command

1. Open the Command Palette with `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
2. Type `Bnd:` to filter to all bnd commands.
3. Select the desired command and follow any prompts.

## Available Commands

| Command | What it does |
|---|---|
| `Bnd: Build Project` | `bnd build` with normal / test / watch mode picker |
| `Bnd: Run` | `bnd run` — pick a `.bndrun` file |
| `Bnd: Test Project` | `bnd test` |
| `Bnd: Run OSGi Tests` | `bnd runtests` |
| `Bnd: Resolve (.bndrun)` | `bnd resolve` — multi-select `.bndrun` files |
| `Bnd: Clean Project` | `bnd clean` |
| `Bnd: Baseline Check` | `bnd baseline` |
| `Bnd: Verify JARs` | `bnd verify` — pick generated JARs |
| `Bnd: Print Bundle Info` | `bnd print` — choose manifest / imports / resources … |
| `Bnd: Diff Bundles` | `bnd diff` — prompts for newer + older JAR |
| `Bnd: Wrap JAR as OSGi Bundle` | `bnd wrap` |
| `Bnd: Export (.bndrun)` | `bnd export` |
| `Bnd: Release Project` | `bnd release` (with confirmation) |
| `Bnd: Show Project Properties` | `bnd properties` |
| `Bnd: Show Project Info` | `bnd info` |
| `Bnd: Show bnd Version` | `bnd version` |
| `Bnd: Evaluate Macro Expression` | `bnd macro` — enter a macro interactively |
| `Bnd: Repository Commands` | `bnd repo` sub-command picker |
| `Bnd: Show CLI Reference` | Opens a searchable panel of all 77 CLI sub-commands |

All commands run output in a dedicated **"bnd"** terminal pane.
