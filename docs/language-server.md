---
title: Build and language server
layout: default
permalink: /language-server/
description: Language server modes, the bnd library and JAR selection, automatic build, export, baselining, native Java project import, and status bar items.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

The extension talks to a bnd language server (LSP). Most features beyond highlighting, completion, and hover depend on it.

```
VS Code (extension host)                   Language server
------------------------                   ----------------------------
bnd extension      <---- IPC / TCP --->    Java JAR | Node | Socket
(starts and restarts the server,           (completion, hover, diagnostics,
 registers the LSP commands)                command handlers, build, launch)
```

## Language server modes

Select the mode with `bnd.server.mode`.

| Mode | Description | Features |
|---|---|---|
| `java` (default) | Starts `biz.aQute.bnd.lsp.jar` with a Java runtime. By default the JAR bundled with the extension is used. | Everything, backed by bndlib. |
| `node` | Runs the TypeScript server inside the extension host. | Highlighting, completion, and hover only. |
| `socket` | Connects to an already running server on `127.0.0.1:<bnd.server.socketPort>` (default 5007). | Depends on the server. |

If the Java JAR is missing, the extension warns and falls back to `node`. Output that bnd workspace plugins print to `System.out` is written to the **bnd Language Server** output channel and does not break the protocol connection.

### Feature availability

| Feature | `java` | `node` |
|---|---|---|
| Highlighting, completion of instructions, macros, and headers, hover | yes | yes |
| Attribute and directive completion, `-runee` values | yes | no |
| Diagnostics and quick fixes | yes | no |
| Effective view | yes | no |
| Repositories, Resolution | yes | no |
| JAR Viewer **Print** page | yes | no |
| Build, clean, baseline, resolve, export, macro evaluation (LSP commands) | yes | no |
| Automatic build | yes | no |
| Run and Debug | yes | no |
| Workspace wizards (create, add fragments) | yes | no |
| bnd Explorer, JAR Viewer **Tree** page, CLI commands | yes | yes |

Older custom or socket servers may lack newer commands. Use the bundled JAR or update the custom server.

### Java runtime for the server

By default the server starts with `JAVA_HOME` or the `java` on your `PATH`. Set `bnd.server.javaExecutable` to use another runtime and `bnd.server.jvmArgs` for additional JVM arguments, for example `-Xmx1g`.

## Status and disabling the server

The compact **bnd** item at the right of the status bar opens the configuration popup. Hover for the language server, automatic build, and CLI command states. The popup switches all three configurations on or off. The language server menu remains available for restart and output actions.

To run the extension **without** a language server process set `bnd.server.enabled` to `false` or run **bnd: Enable/Disable Language Server**. The command writes the setting to the workspace when a folder is open, otherwise to the User settings.

While disabled, the following are unavailable: completion, hover, diagnostics, quick fixes, the Effective, Repositories, and Resolution views, JAR Print, the LSP commands, workspace creation, and launches. Syntax highlighting, the bnd Explorer, the JAR tree, and the bnd CLI commands keep working. The [native Java project import](#native-java-project-import) is not affected because it runs inside the Java language server.

Use **bnd: Restart Language Server** after changing server settings.

## Selecting the server JAR

Run **bnd: Select Language Server JAR...** to choose the JAR used in `java` mode.

| Choice | Settings written | Source |
|---|---|---|
| Bundled | `bnd.server.jarSource: bundled` | The JAR shipped with the extension. |
| Release | `jarSource: release`, `jarVersion` | `biz.aQute.bnd:biz.aQute.bnd.lsp` from `bnd.cli.mavenRepository`, verified against its `.sha1`. |
| Snapshot | `jarSource: snapshot`, `jarVersion` | `bnd.cli.snapshotRepository`, verified against its `.sha1`. |
| Custom URL | `jarSource: url`, `jarUrl`, optional `jarSha256` | Any https URL. |
| Local file | `bnd.server.jar` | A local JAR, for example a build output. It is started from a copy so it can be rebuilt while the server runs. |

Notes:

- `bnd.server.jar` always wins. A configured but missing path produces a warning.
- `jarVersion: latest` checks for the newest release or snapshot on every server start.
- Downloads are cached in the extension's global storage (`library/lsp`, the newest three JARs are kept). Startup never waits for the network: until a download is cached, the bundled JAR is used, and a notification offers a restart once another JAR is ready.
- `jarSource`, `jarVersion`, `jarUrl`, and `jarSha256` are machine-scoped, so a workspace cannot redirect the server to a different JAR.
- `biz.aQute.bnd.lsp` is not yet published to Maven Central or the bndtools snapshot repository. Until then use **Bundled**, **Custom URL**, or **Local file**.

The bundled server and the JDT LS adapter are built from bnd 7.6.0 development sources. The exact source commit, versions, and checksums are listed in [`server/bundled-jars.json`]({{ site.repository_url }}/blob/main/server/bundled-jars.json).

## Automatic build

With the Java language server, bnd projects **build incrementally**. The server builds the affected projects when

- a `.bnd` file is saved,
- compiled classes change below `bin` (or `bin.vscode`),
- a file is deleted from a project, or
- the workspace is refreshed with **Refresh Workspace Files** in the bnd explorer. This builds every project that bnd finds out of date.

The Java language server compiles the sources; bnd packages the result.

The setting `bnd.build.auto` (default `true`) controls it. It needs a trusted workspace: in an untrusted workspace the switch stays on but nothing is built.

Automatic build is controlled by the same **bnd** configuration popup. **bnd: Toggle Automatic Build**, **bnd: Enable Automatic Build**, and **bnd: Disable Automatic Build** also change the setting. Turning off the language server automatically turns off automatic build. The commands write `bnd.build.auto` to the User settings, or to the workspace settings when the workspace already sets it. If VS Code reports that the setting is not registered after an extension update, reload the window.

| Status bar text | Meaning |
|---|---|
| Automatic Build switch: On | On and idle. |
| Automatic Build switch: On, build running | A build is running. |
| Automatic Build switch: On, build failed | The last build reported N errors. |
| Automatic Build switch: Off | Switched off. |
| Automatic Build switch: On, workspace untrusted | On, but paused because the workspace is not trusted. |

The tooltip shows the state, the result of the last build, and a **Show output** link. Completed builds with their errors and warnings per project are listed with timestamps in the **bnd Build** output channel (**bnd: Show Build Output**). Successful builds raise no notification. The item is hidden while the server is stopped, disabled, or too old to support automatic build.

## Build, clean, and baseline commands

These commands act on the project of the active or selected bnd file and do not need the bnd CLI.

| Command | Effect |
|---|---|
| **bnd: Build Project (LSP)** | Builds the project. |
| **bnd: Clean Project (LSP)** | Cleans the project. On a workspace file such as `cnf/build.bnd` it cleans every project. |
| **bnd: Baseline Project (LSP)** | Compares each bundle of the project with its `-baseline` repository and prints the per-package report to the **bnd Language Server** output channel. |
| **bnd: Resolve Runbundles (LSP)** | Resolves the active or selected `.bndrun` file as a dry run and reports resolution errors. It does not modify the file. |
| **bnd: Evaluate Macro (LSP)** | Evaluates a macro expression in the context of the current file. |

Use the [CLI commands]({{ '/cli/' | relative_url }}) when you need `bnd`'s exact terminal behavior, for example to write the resolved `-runbundles` back to the file.

## Export a run

**bnd: Export Run (LSP)...** exports the active or selected `.bndrun` or `bnd.bnd` file. It is also in the Explorer and bnd Explorer context menus. Choose

- **Executable JAR** (`bnd.executablejar`), started with `java -jar`, or
- **Run bundles folder** (`bnd.runbundles`).

The workspace bundles of the run are built first. The result goes to `generated/export` of the owning project (the project's `target-dir`), and **Reveal** shows it in the file manager. Errors and warnings go to the **bnd Language Server** output channel. Export requires a trusted workspace.

## Native Java project import

The extension contributes a headless bnd adapter to Language Support for Java (`redhat.java`). It requires JDT LS 1.61 or later (Red Hat Java 1.56 or later) running on **Java 21 or later**.

In a bnd workspace the adapter imports Java projects **ahead of Gradle**: source and test roots, separate output directories, `-buildpath`, `-testpath`, compiler settings, and JRE containers. Changes to `.bnd` and `.mvn` files refresh the classpath.

- Do not let Gradle or Buildship manage the same projects in the same Java language-server workspace.
- Use valid runtime names in `java.configuration.runtimes`, such as `JavaSE-21` and `JavaSE-25`, not folder names such as `JAVA21`.
- Source and output directories must currently be inside their project directory.
- After upgrading, run **Java: Clean Java Language Server Workspace** once and allow the reimport to remove stale source roots.
- To refresh the classpath without clearing the workspace run **Java: Reload Projects**. Automatic updates also depend on `java.configuration.updateBuildConfiguration`: use `automatic` for unattended refreshes, or approve the update when it is `interactive`.
- Projects that Eclipse Bndtools manages (their `.project` names the Bndtools nature) are not modified. See [Parallel use with Eclipse]({{ '/eclipse/' | relative_url }}).
- Disabling the bnd language server does not disable this import.
