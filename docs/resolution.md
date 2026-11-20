---
title: Resolution view
layout: default
permalink: /resolution/
description: Compare OSGi requirements and capabilities of bundles with the Resolution panel.
---

The **Resolution** view appears in the bottom Panel next to Terminal, Problems, and Debug Console. It helps you answer the question "which requirements of these bundles are satisfied by the others?" before you start a real resolve.

![Resolution panel comparing requirements and capabilities of the Gogo shell and runtime bundles]({{ '/images/resolution.png' | relative_url }})

## Adding resources

You can analyze:

- `.bnd` files (a project or sub-bundle description),
- `.jar` files, and
- bundles or versions from the [Repositories view]({{ '/repositories/' | relative_url }}).

Ways to add them:

- Select versions in the Repositories view and choose **Analyze in Resolution View**. This **replaces** the analyzed resources with the selection; bundles use their newest available version.
- Use **Add Resource to Resolution View...** from the Resolution view toolbar, or from the bnd Explorer context menu on a matching `.bnd` or `.jar` file.
- **Drag** repository entries or local `.bnd` and `.jar` files into the Resolution view. This **adds** to the existing selection.
- Use **Refresh Resolution View** and **Clear Resolution View** in the view toolbar to recompute or empty the list.

The resource list is saved per VS Code workspace. Deleting selected files or their containing folder removes them from the view. Removing a folder from the VS Code workspace removes its resources; resources of other folders stay.

## Reading the result

The view lists the requirements and capabilities of the selected resources. A requirement is marked **matched** when a selected resource provides a matching capability.

- Filter both lists with space-separated terms. `*` and `?` are wildcards.
- Hide optional requirements, or show unresolved requirements only.
- Select a row to copy its attributes, directives, and source.

## Limits

- This is **capability matching, not a full OSGi resolver.** A matched requirement does not prove that a framework can resolve or launch the bundles.
- Analysis reads saved files and accepts at most **100 resources**.
- For `bnd.bnd` projects with sub-bundles only the first sub-builder is analyzed. Select the individual sub-bundle `.bnd` files or their generated JARs to compare the others.
- `.bndrun` files are not accepted. To resolve run bundles use **bnd-cli: Resolve (.bndrun)** or **bnd: Resolve Runbundles (LSP)**.
- The view requires a trusted workspace and the Java language server. The Node fallback does not provide resource analysis.
