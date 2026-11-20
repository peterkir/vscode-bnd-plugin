---
title: Troubleshooting
layout: default
permalink: /troubleshooting/
description: Fix common problems with the bnd / bndtools extension - language server startup, missing features, Java versions, and Eclipse coexistence.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

## A feature is missing or reports "unavailable"

Most features depend on the **Java language server** and a **trusted workspace**. Check these first:

1. Look at the **bnd LS** status bar item. It must show **running** with mode `java`.
2. Check that the workspace is trusted (**Workspaces: Manage Workspace Trust**).
3. Check that `bnd.server.enabled` is `true`.

| Feature | Needs |
|---|---|
| Repositories, Effective, Resolution | Trusted workspace, Java server with the matching command |
| Automatic build | Trusted workspace, `bnd.build.auto`, server with automatic build support |
| Run and Debug | Trusted workspace, Java server, Debugger for Java |
| Workspace wizards | Trusted window, Java server |
| JAR Viewer **Print** page | Java server |
| Native Java project import | Language Support for Java 1.56+, JDT LS on Java 21+ |
| `bnd-cli:` commands | A working `bnd.cli.executable` |

Older custom JARs and socket servers may lack newer commands. Switch to the bundled JAR with **bnd: Select Language Server JAR...** to rule that out.

## The language server does not start

1. Open **View > Output** and select **bnd Language Server**. The first initialization exception usually appears **before** any process-exit message. An exit code `0` only means the Java process shut down cleanly; look earlier for the cause.
2. Run **Developer: Show Running Extensions** and confirm that only the intended bnd extension is active.
3. Run **Developer: Open Logs Folder** and inspect the current window's `exthost/exthost.log` and the `bnd Language Server.log` file below `exthost/output_logging_*`.
4. Turn on debug logging for the Java server, then run **bnd: Restart Language Server**:

   ```json
   {
     "bnd.server.jvmArgs": [
       "-Dorg.slf4j.simpleLogger.defaultLogLevel=debug"
     ]
   }
   ```

5. Temporarily set `bnd.server.mode` to `node`. If completion and hover then work, the extension itself is healthy and the problem is specific to Java startup or the Java server.

### Java not found or too old

The server needs Java 17 or later. Set `bnd.server.javaExecutable` to a suitable runtime, or set `JAVA_HOME` and restart VS Code.

### Large P2 indexes fail with JAXP00010003

Large Eclipse P2 indexes can exceed the XML entity limits of Java 24 and later. Add both arguments to `bnd.server.jvmArgs` and restart the server:

```json
{
  "bnd.server.jvmArgs": [
    "-Djdk.xml.maxGeneralEntitySizeLimit=0",
    "-Djdk.xml.totalEntitySizeLimit=0"
  ]
}
```

## Java projects are not recognized or have stale classpaths

The native bnd import runs in Red Hat Java's JDT LS.

- Run **Java: Clean Java Language Server Workspace** once after upgrading, and allow the reimport.
- Run **Java: Reload Projects** to refresh classpaths without clearing the workspace. Check `java.configuration.updateBuildConfiguration`.
- Use valid execution-environment names in `java.configuration.runtimes`, such as `JavaSE-21`, not folder names such as `JAVA21`.
- Make sure Gradle or Buildship does not manage the same projects.

## A launch does not start

- Is the workspace trusted, and is the Java server running (not `node`)?
- Are **Debugger for Java** and **Language Support for Java** installed?
- A `.bndrun` outside a bnd workspace needs the exact `-standalone` instruction.
- If bundle files are missing, accept the prompt to build, or set `buildBeforeLaunch` to `true` in `launch.json`.
- An error that names another holder of `-runstorage` means a second launch of the same target is still running. Stop it first.

See [Run and Debug]({{ '/run-debug/' | relative_url }}).

## A `.bndrun` shows a problem marker after creating a workspace

The `.bndrun` files from some fragments (for example Eclipse RCP) are unresolved until the P2 repositories are indexed and the projects are built. Browse the Repositories view once and run **bnd-cli: Build Project**.

## bnd CLI commands are missing or fail

- The `bnd-cli:` commands are hidden by default. Run **bnd-cli: Toggle CLI Commands in Command Palette**.
- `bnd` not found: run **bnd-cli: Configure bnd Library...**, or set `bnd.cli.executable` to `bnd` (on `PATH`) or `java -jar /path/to/biz.aQute.bnd.jar`.
- Wrong Java version: run **bnd-cli: Select Java Runtime for bnd CLI**, or **bnd-cli: Discover Java Runtimes from Folder...** if the runtime is not listed.
- Downloads fail behind a proxy or firewall: set `bnd.cli.mavenRepository` to an internal Central-compatible mirror.

## Builds do not run automatically

- The **bnd: auto-build** item must be visible. It is hidden while the server is stopped, disabled, or too old.
- It shows `(untrusted)` in an untrusted workspace; trust the workspace.
- It shows `off` when `bnd.build.auto` is `false`. Click it and select **Enable Automatic Build** to switch the build on.
- Open **bnd: Show Build Output** to see errors and warnings per project.

## Eclipse and VS Code overwrite each other's output

Run **bnd: Configure Parallel Use with Eclipse...** and follow [Parallel use with Eclipse]({{ '/eclipse/' | relative_url }}). If the **Eclipse** status bar item never appears although Eclipse is running, the Eclipse workspace is probably not the bnd workspace root, or the Eclipse version does not write `.metadata/.lock_info`.

## Repositories view is empty

- The VS Code folder itself must contain `cnf/build.bnd`. A `cnf/build.bnd` in a sub-folder is not a separate workspace.
- The workspace must be trusted and the Java server running.
- **Work Offline** may be active. Select **Work Online** and **Refresh Repositories**.

## Report a problem

Open an issue in the [issue tracker]({{ site.repository_url }}/issues). Please include

- the extension version (Extensions view),
- the operating system and VS Code version,
- the Java version used by the server,
- the mode shown in **bnd LS**,
- the first error in the **bnd Language Server** output channel, and
- a minimal workspace or file that reproduces the problem.

For questions about bnd itself, see the [bnd documentation](https://bnd.bndtools.org) and the [bnd repository](https://github.com/bndtools/bnd).
