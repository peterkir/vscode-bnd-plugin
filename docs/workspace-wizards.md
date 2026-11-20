---
title: Workspace wizards
layout: default
permalink: /workspace-wizards/
description: Create a bnd workspace from a template, add fragments such as an Eclipse RCP application, or import an existing workspace.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

The wizards replace the Eclipse **New bnd Workspace** dialogs. When a folder is open but contains no bnd workspace, the **bnd** Explorer replaces its file tree with three actions. The same actions appear when no folder is open.

![bnd Explorer welcome actions in an empty folder]({{ '/images/wizard-welcome.png' | relative_url }})

| Action | Command | Purpose |
|---|---|---|
| Create New Workspace From Template | `bnd.wizard.createWorkspace` | Generate a complete workspace from one template. |
| Add Fragment to (New) Workspace | `bnd.wizard.addFragment` | Add one or more fragments (projects, repositories, run files) to a new or existing workspace. |
| Import Existing Workspace | `bnd.wizard.importWorkspace` | Open or add an existing workspace. |

All three are in the Command Palette (prefix **bnd:**) and in the bnd Explorer menu.

## Requirements

- A **trusted** window. Template evaluation can run bnd macros.
- The bundled Java language server (or a custom server that supports the workspace wizards). The Node fallback reports the operation as unsupported.
- Import works without the Java server.

## Walkthrough: from an empty folder to an Eclipse RCP application

1. **Open an empty folder** (here `com.example.rcp`), select the **bnd** icon in the Activity Bar, and choose **Create New Workspace From Template**. The list comes from `bnd.wizard.workspaceTemplateIndexes`. The default is the minimal bndtools workspace.

   ![Create New Workspace From Template quick pick]({{ '/images/wizard-create-template.png' | relative_url }})

2. **Review the confirmation.** It names the destination, the template sources, and the trust and overwrite consequences. **Open Template** shows a source in your browser without creating anything. Confirm with **Create Workspace**.

   ![Workspace creation confirmation dialog]({{ '/images/wizard-create-confirm.png' | relative_url }})

3. **Inspect the result.** The bnd Explorer shows the generated `cnf/` configuration and build files. The Repositories view lists the workspace and its configured repositories.

   ![Generated minimal workspace with cnf/build.bnd open]({{ '/images/wizard-created.png' | relative_url }})

4. **Add fragments.** Run **Add Fragment to (New) Workspace**. The catalog defaults to the upstream [bndtools/workspace-templates](https://github.com/bndtools/workspace-templates) index. Type to filter, tick one or more fragments with the checkboxes (here **Eclipse RCP E4 Application** and **Eclipse RCP SWTBot Tests**), and press <kbd>Enter</kbd>. Required fragments such as **Eclipse Platform 4.41** are added automatically.

   ![Add Fragment quick pick filtered to Eclipse RCP fragments]({{ '/images/wizard-add-fragments.png' | relative_url }})

5. **Confirm.** The warning lists all fragments including their dependencies. Confirm with **Add Fragments**.

   ![Fragment confirmation dialog listing the selected and required fragments]({{ '/images/wizard-add-fragments-confirm.png' | relative_url }})

6. **Use the result.** The fragments add the projects `example.rcp.app.ui` and `example.rcp.app.ui.swtbot.tests`, repository definitions in `cnf/ext/*.bnd` for the Eclipse Platform and SWTBot P2 sites, and `.bndrun` files with **Run OSGi** and **Debug OSGi** CodeLens. The Repositories view indexes the P2 sites on first access.

   ![Generated RCP workspace with app.ui_shared.bndrun open and P2 repositories listed]({{ '/images/wizard-add-fragments-result.png' | relative_url }})

> The `.bndrun` file created by the RCP fragments shows a problem marker until the P2 repositories are indexed and the projects are built. Browse the Repositories view and run **bnd-cli: Build Project** to populate them.

The finished workspace is stored in the repository as [examples/com.example.rcp]({{ site.repository_url }}/tree/main/examples/com.example.rcp).

## How creation works

- Creation and fragment addition use the **current VS Code folder** directly. In a multi-root workspace, select the target folder. With no folder open, select a destination directory; it opens automatically afterwards. The workspace name is the directory name.
- **Create New Workspace From Template** selects exactly one current template. **Add Fragment to (New) Workspace** selects one or more current fragments. Required dependencies are included automatically and archived entries are hidden.
- Before anything is written, a single warning lists the destination, the selected templates and dependencies, trust risks, and possible overwrites. Cancel it and nothing changes. There is no generated-file preview and no staging directory.
- **No build is started.** Run a build afterwards.
- Existing unrelated files in the directory are preserved. An existing `cnf/build.bnd` is rejected for new workspaces; use the fragment wizard for existing workspaces.
- Multiple fragments that supply the same file are composed in dependency order and are not merged automatically. Template `append` actions retain existing content; other supplied files replace existing contents, as the warning states.
- Application rejects unsaved target editors and files that changed while generating, blocks symbolic-link destinations, and rolls back written files if it fails.
- Limits: at most 5000 files and 32 MiB of output. Delete actions and Eclipse project templates are not supported.

## Template sources

Workspace templates and fragment catalogs are configured independently.

| Setting | Default | Used by |
|---|---|---|
| `bnd.wizard.workspaceTemplateIndexes` | `https://github.com/bndtools/bndtools.workspace.min` | Create New Workspace From Template |
| `bnd.wizard.fragmentTemplateIndexes` | `https://raw.githubusercontent.com/bndtools/workspace-templates/master/index.bnd` | Add Fragment to (New) Workspace |
| `bnd.wizard.templateIndexes` | upstream fragment index | Deprecated fallback for the fragment catalog only |

Add your own sources with:

- **bnd: Add Workspace Template URL...** accepts a GitHub workspace-template repository, a ZIP archive, or a `.bnd` catalog of full workspace templates. GitHub repository URLs use `master` unless a `/tree/ref/path` URL or `#ref` names another ref.
- **bnd: Add Fragment Template URL...** accepts an HTTP(S) or `file:` URL of a fragment `index.bnd`.

Both commands append the location to the matching User setting without creating duplicates.

> **Only use trusted sources.** Template evaluation can run bnd macros.

## Import an existing workspace

Run **bnd: Import Existing Workspace...** from the Command Palette, the bnd Explorer menu, or the welcome link of an empty window.

1. Select a folder that contains `cnf/build.bnd`.
2. Choose whether to open it in the current window, in a new window, or add it to the current multi-root workspace.

Importing only checks the folder structure. It does not evaluate bnd configuration, copy files, delete Eclipse metadata, or start a build. Adding a root that is already present does not create a duplicate, even when you select it through a symbolic link.
