---
title: Getting started
layout: default
permalink: /getting-started/
description: A first tour - open or create a bnd workspace and use the main features of the extension.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

This page walks you through the first ten minutes. It assumes the extension is [installed]({{ '/installation/' | relative_url }}).

## Concepts in one minute

| Term | Meaning |
|---|---|
| **bnd workspace** | A folder that contains `cnf/build.bnd`. `cnf/` holds the shared configuration and repository definitions. |
| **Project** | A sub-folder of the workspace with a `bnd.bnd` file. It builds one or more bundles. |
| **`.bnd` file** | Configuration of a project, a bundle, or the workspace (`bnd.bnd`, `build.bnd`, `ext/*.bnd`). |
| **`.bndrun` file** | A run description: framework, requirements, and the resolved `-runbundles`. |
| **Repository** | A source of bundles, for example a Maven repository, an OSGi index, a P2 site, or the workspace itself. |

The extension recognizes the file types `.bnd`, `.bndrun`, and `.mvn` (Maven coordinates for bnd).

## Step 1: Open or create a workspace

**You already have a bnd workspace.** Use **File > Open Folder...** and select the folder that contains `cnf/build.bnd`. A folder one level deeper, for example an examples directory, is not treated as its own workspace; the workspace root must be the VS Code folder itself.

**You start from scratch.** Open an empty folder and select the **bnd** icon in the Activity Bar. Choose **Create New Workspace From Template** and follow the [Workspace wizards]({{ '/workspace-wizards/' | relative_url }}) page.

**You have a workspace elsewhere.** Run **bnd: Import Existing Workspace...** to open it or add it to your current multi-root workspace.

When prompted, trust the workspace so that repositories, builds, and launches work.

## Step 2: Tour the bnd Activity Bar

The **bnd** container in the Activity Bar contains two views:

- **Explorer** - a file tree of the bnd workspace with bnd-specific actions.
- **Repositories** - the bundle repositories of each workspace. See [Explorer and Repositories]({{ '/repositories/' | relative_url }}).

The **Resolution** view lives in the bottom panel next to Terminal and Problems. See [Resolution view]({{ '/resolution/' | relative_url }}).

## Step 3: Edit a bnd file

Create or open `bnd.bnd` in a project:

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

Press <kbd>Ctrl</kbd>+<kbd>Space</kbd> for completions, hover over instructions for documentation, and use **bnd: Open Effective** to see the evaluated properties. Details are in [Editing bnd files]({{ '/editing/' | relative_url }}).

## Step 4: Build

With the Java language server running, projects build incrementally. Saving a `.bnd` file or compiling Java classes triggers a build of the affected projects. The **bnd: auto-build** status bar item shows the result. See [Build and language server]({{ '/language-server/#automatic-build' | relative_url }}).

You can also use the CLI. Run **bnd-cli: Toggle CLI Commands in Command Palette** once to show the `bnd-cli:` commands, then **bnd-cli: Build Project**.

## Step 5: Run and debug

Open a `.bndrun` file and select **Run OSGi** or **Debug OSGi** at the top of the editor. Breakpoints in your bundles work as in any Java program. See [Run and Debug]({{ '/run-debug/' | relative_url }}).

A minimal `launch.bndrun` looks like this:

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

`-standalone` is only needed outside a bnd workspace. Run **bnd-cli: Resolve (.bndrun)** to compute `-runbundles` from `-runrequires` and write the result back to the file (`bnd resolve resolve -W`). **bnd: Resolve Runbundles (LSP)** resolves through the language server without changing the file and reports resolution errors.

## Step 6: Use the built-in walkthrough

VS Code includes an interactive walkthrough with the same topics. Run **Welcome: Open Walkthrough...** and select **Get Started with OSGi with bnd/bndtools**.

## Where to go next

- [Editing bnd files]({{ '/editing/' | relative_url }}) for completion, hover, diagnostics, and the Effective table.
- [Configuration reference]({{ '/reference/' | relative_url }}) for all settings and commands.
- [Troubleshooting]({{ '/troubleshooting/' | relative_url }}) when features are missing.
