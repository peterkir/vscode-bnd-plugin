---
title: bnd CLI commands
layout: default
permalink: /cli/
description: Run bnd command line tools from the Command Palette, configure the bnd library and Java runtime, and search the CLI reference.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

The extension wraps the [bnd command line](https://bnd.bndtools.org/commands/overview.html) so that you can run common commands from the Command Palette. Commands run in an integrated terminal named **bnd**.

Two prefixes appear in the Command Palette (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>):

- **`bnd-cli:`** runs the bnd CLI in a terminal.
- **`bnd:`** runs language-server and other extension actions. They do not need the CLI.

## Show the CLI commands

CLI commands are **hidden by default** to keep the palette short. Open the compact package status item or run **bnd-cli: Toggle CLI Commands in Command Palette** to show or hide them. The **bnd Configuration** popup contains an on/off switch for CLI palette visibility. The toggle command always stays visible.

- The choice is saved in the extension's global storage, applies to all workspaces of the current VS Code profile, and survives restarts.
- No settings file is modified, so a broken `settings.json` cannot block the toggle.
- Before the first toggle, the User setting `bnd.cli.showCommands` (default `false`) provides the initial value. Afterwards the stored choice wins.
- The toggle only affects palette visibility, not command execution or context menus.

## Commands

| Command | Runs | Notes |
|---|---|---|
| **bnd-cli: Build Project** | `bnd build` | Choose normal, test, or watch mode. |
| **bnd-cli: Run** | `bnd run` | Pick a `.bndrun` file or use the current project. |
| **bnd-cli: Test Project** | `bnd test` | |
| **bnd-cli: Run OSGi Tests** | `bnd runtests` | |
| **bnd-cli: Resolve (.bndrun)** | `bnd resolve resolve -W` | Multi-select `.bndrun` files. Writes the resolved `-runbundles` back. |
| **bnd-cli: Clean Project** | `bnd clean` | |
| **bnd-cli: Baseline Check** | `bnd baseline` | |
| **bnd-cli: Verify JARs** | `bnd verify` | Pick generated JARs. |
| **bnd-cli: Print Bundle Info** | `bnd print` | Choose the view mode and the JAR. |
| **bnd-cli: Diff Bundles** | `bnd diff` | Prompts for the newer and the older JAR. |
| **bnd-cli: Wrap JAR as OSGi Bundle** | `bnd wrap` | |
| **bnd-cli: Export (.bndrun)** | `bnd export` | |
| **bnd-cli: Release Project** | `bnd release` | Asks for confirmation first. |
| **bnd-cli: Show Project Properties** | `bnd properties` | |
| **bnd-cli: Show Project Info** | `bnd info` | |
| **bnd-cli: Show bnd Version** | `bnd version` | |
| **bnd-cli: Evaluate Macro Expression** | `bnd macro` | Enter a macro expression. |
| **bnd-cli: Repository Commands** | `bnd repo` | Sub-command picker. |

Three more commands configure the CLI and run inside the extension, not in a terminal:

| Command | Purpose |
|---|---|
| **bnd-cli: Configure bnd Library...** | Select a bnd release, a snapshot, or a custom https JAR and set `bnd.cli.executable` accordingly. |
| **bnd-cli: Select Java Runtime for bnd CLI** | Choose one of the runtimes in `java.configuration.runtimes`. Its `bin/java` is used for `java -jar` execution (`bnd.cli.javaExecutable`). |
| **bnd-cli: Discover Java Runtimes from Folder...** | Scan a root folder recursively for Java runtimes and append the ones found to `java.configuration.runtimes`. |

Together with **bnd-cli: Toggle CLI Commands in Command Palette** and **bnd-cli: Show CLI Reference** these make the 23 `bnd-cli:` commands.

## Setting up the bnd executable

The setting `bnd.cli.executable` tells the extension how to start bnd. The extension manages it for you unless you set it yourself. To use your own installation:

```jsonc
// settings.json
{
  // bnd is on your PATH (for example installed with a package manager):
  "bnd.cli.executable": "bnd",

  // or run it as an executable JAR:
  "bnd.cli.executable": "java -jar /path/to/biz.aQute.bnd.jar"
}
```

To let the extension manage a downloaded JAR instead:

1. Run **bnd-cli: Configure bnd Library...**.
2. Select a release, a snapshot, or enter a custom https JAR URL.
3. The JAR is stored in the extension's `library/tool` storage folder, and `bnd.cli.executable` becomes `java -jar ...`.

If your Java runtime is not listed in `java.configuration.runtimes`, run **bnd-cli: Discover Java Runtimes from Folder...** first, then **bnd-cli: Select Java Runtime for bnd CLI**.

To download releases from a Maven Central mirror, set the repository first:

```json
{
  "bnd.cli.mavenRepository": "https://repo1.maven.org/maven2",
  "bnd.cli.javaExecutable": "java"
}
```

Snapshots come from `bnd.cli.snapshotRepository` (default: the bndtools Artifactory `libs-snapshot-local`).

## CLI Reference panel

Run **bnd-cli: Show CLI Reference** to open a searchable panel with all **77** bnd CLI sub-commands, their complete option lists, and examples from the official documentation.

![CLI Reference panel filtered to "wrap" with the command expanded]({{ '/images/cli-reference.png' | relative_url }})

## CLI or language server?

| You want to | Use |
|---|---|
| Build, clean, or baseline a project without a terminal | **bnd: Build Project (LSP)**, **bnd: Clean Project (LSP)**, **bnd: Baseline Project (LSP)** |
| Keep builds up to date while you edit | [Automatic build]({{ '/language-server/#automatic-build' | relative_url }}) |
| Resolve `.bndrun` files and write `-runbundles` back | **bnd-cli: Resolve (.bndrun)** |
| Check whether a `.bndrun` resolves without changing it | **bnd: Resolve Runbundles (LSP)** |
| Export an executable JAR | **bnd: Export Run (LSP)...** or **bnd-cli: Export (.bndrun)** |
| Release a bundle | **bnd-cli: Release Project** |
| Run any other bnd command | **bnd-cli: Repository Commands**, or your own terminal with the configured executable |
