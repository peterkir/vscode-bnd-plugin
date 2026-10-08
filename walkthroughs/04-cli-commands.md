# Integrated bnd CLI Commands

All bnd CLI commands are available directly from the VS Code Command Palette — no terminal required.

## Setting Up the bnd Executable

The extension downloads the latest bnd release on first activation and configures `bnd.cli.executable` for you.

Run **bnd-cli: Configure bnd Library...** to switch to another release, a snapshot build, or a JAR from your own https URL. The choice is stored in the workspace settings.

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

Run **bnd: Select Language Server JAR...** to switch between the bundled JAR, a release, a snapshot, a custom https URL, or a local file.

If the bundled JAR is missing, the extension issues a warning and falls back to the Node server.

## Running a Command

1. Open the Command Palette with `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
2. Type `bnd-cli:` for CLI commands, or `bnd:` for language-server and other extension actions.
3. Select the desired command and follow any prompts.

CLI palette commands are hidden by default. **bnd-cli: Toggle CLI Commands in Command Palette** shows or hides them. It always remains available and saves its choice in extension global storage without writing User settings. Before the first toggle, `bnd.cli.showCommands` supplies the initial value (default `false`); the stored toggle choice then takes precedence. Existing saved choices are preserved. The preference survives restarts and applies across workspaces in the current profile; context menus and command execution remain unchanged.

## Available Commands

| Command | What it does |
|---|---|
| `bnd-cli: Build Project` | `bnd build` with normal / test / watch mode picker |
| `bnd-cli: Run` | `bnd run` — pick a `.bndrun` file |
| `bnd-cli: Test Project` | `bnd test` |
| `bnd-cli: Run OSGi Tests` | `bnd runtests` |
| `bnd-cli: Resolve (.bndrun)` | `bnd resolve resolve -W` — multi-select `.bndrun` files |
| `bnd-cli: Clean Project` | `bnd clean` |
| `bnd-cli: Baseline Check` | `bnd baseline` |
| `bnd-cli: Verify JARs` | `bnd verify` — pick generated JARs |
| `bnd-cli: Print Bundle Info` | `bnd print` — choose manifest / imports / resources … |
| `bnd-cli: Diff Bundles` | `bnd diff` — prompts for newer + older JAR |
| `bnd-cli: Wrap JAR as OSGi Bundle` | `bnd wrap` |
| `bnd-cli: Export (.bndrun)` | `bnd export` |
| `bnd-cli: Release Project` | `bnd release` (with confirmation) |
| `bnd-cli: Show Project Properties` | `bnd properties` |
| `bnd-cli: Show Project Info` | `bnd info` |
| `bnd-cli: Show bnd Version` | `bnd version` |
| `bnd-cli: Evaluate Macro Expression` | `bnd macro` — enter a macro interactively |
| `bnd-cli: Repository Commands` | `bnd repo` sub-command picker |
| `bnd-cli: Show CLI Reference` | Opens a searchable panel of all 77 CLI sub-commands |

CLI executions run output in a dedicated **"bnd"** terminal pane. Configuration, reference, and visibility commands run inside the extension.
