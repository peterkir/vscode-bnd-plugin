---
title: Explorer and Repositories
layout: default
permalink: /repositories/
description: The bnd Explorer and the Repositories view - browse Workspace, Maven, OSGi indexed, and P2 repositories, search, and use bundles in your projects.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

The **bnd** icon in the Activity Bar opens a container with two independent views: **Explorer** above **Repositories**. VS Code remembers any order you customize.

## bnd Explorer

The Explorer shows the files of every bnd workspace in your window. It offers the actions of VS Code's built-in Explorer, in the same context-menu groups and with the same default keys, and adds bnd actions.

| Action | Notes |
|---|---|
| New File, New Folder | |
| Open to the Side | <kbd>Ctrl</kbd>+<kbd>Enter</kbd> |
| Open With... | choose another editor, for example the JAR Viewer |
| Reveal in File Explorer | <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> |
| Open in Integrated Terminal, Find in Folder | |
| Cut, Copy, Paste | <kbd>Ctrl</kbd>+<kbd>X</kbd>, <kbd>Ctrl</kbd>+<kbd>C</kbd>, <kbd>Ctrl</kbd>+<kbd>V</kbd>; copies are named `name copy.ext` |
| Copy Path, Copy Relative Path | <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>, <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> |
| Rename | <kbd>F2</kbd> |
| Delete | <kbd>Delete</kbd>; moves to the Recycle Bin or Trash |
| Select for Compare, Compare with Selected | |

Dragging moves files inside the tree; files dropped from outside are copied. On matching files the context menu also offers the bnd actions **Run/Debug OSGi** and **Export Run** (`.bndrun` and `bnd.bnd`), **Open Effective** (`.bnd`, `.bndrun`), **Open with bnd JAR Viewer** (`.jar`), and **Add Resource to Resolution View...**.

**Exclusions.** The setting `bnd.explorer.exclude` lists exact file or folder names that are hidden at every level. The default is `.git` and `node_modules`. It is independent of `files.exclude` and takes no glob patterns.

Context-menu entries that other extensions add to the built-in Explorer are not available here. Use **Reveal in Explorer View** to reach them in the built-in Explorer.

When no bnd workspace is found, the Explorer shows the [workspace wizards]({{ '/workspace-wizards/' | relative_url }}) instead.

## Repositories view

This view is a port of the Bndtools Eclipse **Repositories** view. It lists one root for each bnd workspace, that is for each VS Code workspace folder that contains `cnf/build.bnd`. Each root shows the **Workspace** repository, with its projects and their bundles, followed by the repository plugins configured in `cnf`.

Expand a repository to see bundles, versions, and **Eclipse features** from P2 or OSGi indexed repositories. Features expose included features, included bundles, and requirements directly from the index metadata, so no feature JARs are downloaded.

| Filtered Maven repository | P2 feature with included bundles |
|---|---|
| ![Repositories view filtered to org.apache.felix.gogo* with a version expanded]({{ '/images/repositories.png' | relative_url }}) | ![Eclipse Platform P2 repository showing the org.eclipse.e4.rcp feature and its included bundles]({{ '/images/repositories-p2.png' | relative_url }}) |

The view requires a trusted workspace and the Java language server, because repository plugins run workspace code. Deleting a workspace or its `cnf/build.bnd` clears its tree automatically.

### Filter

**Filter Repositories...** matches bundle symbolic names. `*` and `?` are wildcards, and the text is matched anywhere in the name. **Clear Repository Filter** removes it.

### Advanced Search

**Advanced Search...** finds providers of

- a **package**, with an optional version range,
- a **service**, or
- any **namespace and LDAP filter**

in repositories that implement the OSGi Repository API. Feature results stay expandable, and member tooltips show requirement filters and optional status.

![Advanced Search result for package org.osgi.service.component in range [1.5,2)]({{ '/images/repositories-search.png' | relative_url }})

### Toolbar

| Action | Effect |
|---|---|
| Refresh | Reload all repositories. |
| Collapse All | Collapse the tree. |
| Work Offline / Work Online | Use only cached content or allow remote access. |

### Working with bundles

- **Open in bnd JAR Viewer.** Activating a bundle opens its newest JAR in the [JAR Viewer]({{ '/jar-viewer/' | relative_url }}); activating a version opens exactly that JAR.
- **Reveal JAR File** and **Show Manifest** are on version nodes.
- **Copy Bundle Symbolic Name**, **Copy Version**, and **Copy as bnd Entry** (`bsn;version='1.2.3'`) are on bundle and version nodes.
- **Download Repository Content** fetches a remote repository, bundle, or version into the local cache.
- **Add Bundles to Repository...** adds JAR files to a writable repository. You can also drop JAR files from the Explorer onto it.
- **Repository Actions...** runs actions contributed by repository plugins (the bnd `Actionable` interface).
- **Analyze in Resolution View** (on version nodes) sends the selection to the [Resolution view]({{ '/resolution/' | relative_url }}).
- **Drag and drop** bundles, versions, or features (single or multi-selection) into a bnd editor. The entries are formatted for the instruction under the drop position: `bsn;version=...` for `-buildpath`, `-runbundles`, and similar instructions, and `osgi.identity;filter:='...'` requirements for `-runrequires` and `-runblacklist`. Features are only inserted into those requirement instructions.

### The bnd-cache repository

The built-in `bnd-cache` repository unpacks bnd's embedded bundles into `cnf/cache/<bnd-version>/bnd-cache` when it is accessed. It is separate from HTTP and Maven download caches and needs no workspace build.

### Defining repositories

Repositories are defined with bnd plugins in `cnf/build.bnd` or `cnf/ext/*.bnd` through the [`-plugin`](https://bnd.bndtools.org/instructions/plugin.html) instruction. See the bnd documentation of the [Maven repository plugin](https://bnd.bndtools.org/plugins/maven.html). The workspace wizards add ready-made definitions, for example for the Eclipse Platform P2 sites.
