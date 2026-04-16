# Integrated bnd CLI Commands

All bnd CLI commands are available directly from the VS Code Command Palette — no terminal required.

## Setting Up the bnd Executable

Open **Settings** (`Ctrl+,`) and search for `bnd.cli.executable`.

| Installation method | Setting value |
|---|---|
| `bnd` on your PATH (e.g. `brew install bnd`) | `bnd` (default) |
| Executable JAR | `java -jar /path/to/biz.aQute.bnd.jar` |

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
