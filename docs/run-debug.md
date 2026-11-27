---
title: Run and Debug
layout: default
permalink: /run-debug/
description: Run and debug OSGi frameworks and OSGi tests from .bndrun files and bnd projects with the Java debugger.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

`.bndrun` files and bnd projects launch through VS Code's **Run and Debug** facility. The Java language server prepares the launch with bnd's `ProjectLauncher` (main class, class path, `-runvm`, `-runprogramargs`, `-runenv`, working directory) and the [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) starts the JVM. Breakpoints, stepping, variables, and the Debug Console work as for any Java program. A run without debugging in the integrated terminal starts the JVM in a dedicated terminal per launch file instead, so several `.bndrun` files run side by side.

![Run OSGi and Debug OSGi CodeLens on a .bndrun file]({{ '/images/launch-codelens.png' | relative_url }})

## Requirements

- A **trusted** workspace.
- The **Java language server** (`bnd.server.mode` set to `java`, or `socket` with a server that supports `bnd.launch.prepare`). The Node fallback cannot launch.
- The **Debugger for Java** and **Language Support for Java** extensions. The bundled adapter imports bnd projects directly into JDT LS, including source and test roots and build and test dependencies. This needs Red Hat Java 1.56 or later with Java 21 or later for JDT LS, which is separate from the `-runee` of the launched framework.
- Valid names in `java.configuration.runtimes`, such as `JavaSE-21` or `JavaSE-25`. After adding native import to an existing workspace run **Java: Clean Java Language Server Workspace** and allow the reimport.
- A `.bndrun` file **outside** a bnd workspace must contain the exact [`-standalone`](https://bnd.bndtools.org/instructions/standalone.html) instruction; `-standalone.extra` alone is not enough. A `bnd.bnd` project always requires a bnd workspace.

For later classpath changes use **Java: Reload Projects** and check `java.configuration.updateBuildConfiguration` for automatic updates or interactive approval.

## Starting a launch

| Where | What |
|---|---|
| **CodeLens** | **Run OSGi** and **Debug OSGi** at the top of a `.bndrun` or a `bnd.bnd` with `-runfw` or `-runbundles`. **Run OSGi tests** and **Debug OSGi tests** on files with `-testpath`. Disable with `bnd.launch.codeLens`. |
| **Editor title** | The run menu in the editor title of `.bndrun` and `bnd.bnd` files. |
| **Context menu** | In the Explorer and the bnd Explorer on `.bndrun` and `bnd.bnd` files. |
| **Command Palette** | **bnd: Run OSGi Framework**, **bnd: Debug OSGi Framework**, **bnd: Run OSGi Tests (Launch)**, **bnd: Debug OSGi Tests**. They use the active `.bndrun` or `bnd.bnd` editor; from any other editor you pick one of the workspace's launch files. |
| <kbd>F5</kbd> | With a `.bndrun` or `bnd.bnd` open and no `launch.json`. |
| **Run and Debug view** | Choose the **bnd OSGi** debug type to list every `.bndrun` file and test project in the workspace. |

## Build before launch

Launch preparation validates the required bundles **without building first**. If bundle files are missing, VS Code asks whether to build their workspace projects and dependencies and retry. Set `buildBeforeLaunch` in `launch.json` to `true` (always build) or `false` (never build) to skip this prompt.

## launch.json

Add a configuration of type `bnd`:

```json
{
  "type": "bnd",
  "request": "launch",
  "name": "bnd: app.bndrun",
  "target": "${workspaceFolder}/my.project/app.bndrun",
  "kind": "run",
  "vmArgs": ["-Xmx1g"]
}
```

| Attribute | Description |
|---|---|
| `target` | The `.bndrun` or `bnd.bnd` file. Default `${file}`. Required. |
| `kind` | `run` launches the framework. `test` runs OSGi tests through the bnd tester (`-testpath`, `-tester`). |
| `tests` | Test names for `kind: test`, for example `com.example.FooTest` or `com.example.FooTest:testBar`. Empty runs all tests. |
| `vmArgs`, `args`, `env` | Appended to `-runvm` and `-runprogramargs`; `env` values override `-runenv`. |
| `console` | `integratedTerminal` (default, supports the Gogo shell), `internalConsole`, or `externalTerminal`. A run without debugging in the integrated terminal gets a dedicated terminal per launch file. |
| `buildBeforeLaunch` | See [Build before launch](#build-before-launch). |
| `javaExec` | Java executable. Defaults to the bnd `java` property, then a runtime matching `-runee` from `java.configuration.runtimes`, then `bnd.cli.javaExecutable`, `JAVA_HOME`, or `PATH`. |
| `shortenCommandLine` | `none`, `jarmanifest`, `argfile`, or `auto` (default). Passed to the Java debugger. |
| `sourcePaths` | Additional source roots for the debugger, appended to the sources of launched workspace bundles. |
| `projectName` | Optional imported Java project used by the Java debugger. |

The debug type offers two snippets, **bnd: Launch .bndrun** and **bnd: OSGi tests**.

An OSGi test configuration looks like this:

```json
{
  "type": "bnd",
  "request": "launch",
  "name": "bnd tests: my.project",
  "target": "${workspaceFolder}/my.project/bnd.bnd",
  "kind": "test",
  "tests": ["com.example.FooTest:testBar"]
}
```

## Good to know

- The Java runtime defaults to the bnd `java` property, then a runtime that matches `-runee`.
- `-runjdb` is ignored because the Java debugger owns the JDWP connection.
- When a debug session ends the extension deletes the temporary launcher files.
- A **Run** without debugging in the integrated terminal starts the JVM as a task in its own terminal, named after the launch, without the Debugger for Java. Different `.bndrun` files, also of the same project, run side by side in separate terminals. Launching the same file again stops its previous run first. The launcher files are deleted when the JVM ends. With `externalTerminal`, the launcher files stay until the same target is launched again or the language server shuts down.
- A launch whose `-runstorage` is held by another launch fails before the JVM starts and names the holder.
- To produce a deployable artifact instead, use **bnd: Export Run (LSP)...** (see [Build and language server]({{ '/language-server/#export-a-run' | relative_url }})).
