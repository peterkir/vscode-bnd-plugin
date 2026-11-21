---
title: Home
layout: default
permalink: /
description: Language support, repositories, resolution analysis, run and debug, and bnd CLI integration for bnd and bndrun files in Visual Studio Code.
---

<div class="hero" markdown="1">

# OSGi with bnd/bndtools
{: .no_toc}

<p class="lead">Edit, build, resolve, run, and debug OSGi projects that use <a href="https://bnd.bndtools.org">bnd</a> without leaving Visual Studio Code.</p>

<a class="button primary" href="{{ '/installation/' | relative_url }}">Install the extension</a>
<a class="button" href="{{ '/getting-started/' | relative_url }}">Getting started</a>
<a class="button" href="{{ site.marketplace_url }}">Open in Marketplace</a>

</div>

![bnd Explorer and Repositories view beside a bnd.bnd editor with the Effective properties table]({{ '/images/effective.png' | relative_url }})

The extension (Marketplace ID `klibio.bnd`) brings the daily workflow of [Bndtools for Eclipse](https://bndtools.org) to VS Code. It understands the `.bnd` and `.bndrun` file formats, embeds a bnd language server, lets you browse bnd repositories, analyzes OSGi requirements and capabilities, launches OSGi frameworks through the Java debugger, and wraps the bnd command line.

## What you get

<div class="cards" markdown="0">
  <div class="card"><h3><a href="{{ '/editing/' | relative_url }}">Editor intelligence</a></h3><p>Syntax highlighting, completion for 153 instructions, macros and 48 headers, hover documentation, diagnostics, quick fixes, and an Effective properties table.</p></div>
  <div class="card"><h3><a href="{{ '/workspace-wizards/' | relative_url }}">Workspace wizards</a></h3><p>Create a bnd workspace from a template, add fragments such as an Eclipse RCP application, or import an existing workspace.</p></div>
  <div class="card"><h3><a href="{{ '/repositories/' | relative_url }}">Repositories</a></h3><p>Browse Workspace, Maven, OSGi indexed, and P2 repositories, search by package or capability, and drag bundles into your files.</p></div>
  <div class="card"><h3><a href="{{ '/resolution/' | relative_url }}">Resolution view</a></h3><p>Compare the requirements and capabilities of bundles to see what is missing before you resolve.</p></div>
  <div class="card"><h3><a href="{{ '/jar-viewer/' | relative_url }}">JAR Viewer</a></h3><p>Inspect any JAR: archive tree, manifest, and the full <code>bnd print</code> report.</p></div>
  <div class="card"><h3><a href="{{ '/run-debug/' | relative_url }}">Run and Debug</a></h3><p>Run and debug <code>.bndrun</code> files and OSGi tests with CodeLens, breakpoints, and the Gogo shell.</p></div>
  <div class="card"><h3><a href="{{ '/language-server/' | relative_url }}">Build and language server</a></h3><p>Incremental automatic build, export of executable JARs, baselining, and native Java project import.</p></div>
  <div class="card"><h3><a href="{{ '/cli/' | relative_url }}">bnd CLI commands</a></h3><p>Run 18 common bnd CLI commands from the Command Palette and search a reference of all 77 bnd sub-commands.</p></div>
  <div class="card"><h3><a href="{{ '/eclipse/' | relative_url }}">Parallel use with Eclipse</a></h3><p>Open the same workspace in Eclipse and VS Code without fighting over build output.</p></div>
</div>

## Requirements at a glance

| Component | Requirement |
|---|---|
| Visual Studio Code | 1.140.0 or later |
| Java | 17 or later for the bundled language server and the bnd CLI |
| Optional: Language Support for Java (`redhat.java`) | 1.56 or later, running JDT LS on Java 21 or later, for native bnd project import |
| Optional: Debugger for Java (`vscjava.vscode-java-debug`) | Required for Run and Debug |
| Workspace trust | Required for repositories, effective view, resolution, build, wizards, and launches |

See [Installation]({{ '/installation/' | relative_url }}) for details and [Troubleshooting]({{ '/troubleshooting/' | relative_url }}) if something does not work.

## About bnd

bnd is the engine behind Bndtools, the Gradle and Maven bnd plugins, and many OSGi builds. This extension does not replace the upstream documentation; it follows it. For the meaning of instructions, headers, and macros see the official [bnd documentation](https://bnd.bndtools.org).

> The extension is a community project and part of the bnd / bndtools ecosystem. Report problems in the [issue tracker]({{ site.repository_url }}/issues).
