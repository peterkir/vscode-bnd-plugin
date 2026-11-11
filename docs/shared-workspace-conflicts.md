# Sharing a workspace directory between Eclipse Bndtools and VS Code

This document describes what happens when Eclipse with Bndtools and VS Code with this extension work on the same bnd workspace directory at the same time, what the extension does about it since version 0.28.0, and what is still open.

## 1. Summary

Each tool has its own bnd workspace model and writes derived files into the shared directory. Sources and bnd configuration can be shared safely: both tools watch the files. Derived files cannot, unless each has one writer at a time or each tool has its own copy.

| Shared resource | Conflict without measures | State with extension 0.28.0 |
|---|---|---|
| `.project`, `.classpath`, `.settings` | The Java project import in VS Code rewrote them; Eclipse lost natures, builders, and its classpath container | The import leaves Eclipse Bndtools projects untouched ([4.3](#43-java-project-import-of-eclipse-projects)) |
| `bin`, `bin_test` | Two Java builders compile into the same directories | VS Code gets its own directories after [configuration](#2-set-up-parallel-use) |
| `generated` | Two bnd builds write the same bundles | VS Code gets its own directory after configuration; builds of one project are serialized by a lock ([4.5](#45-cross-process-locks-in-bnd)) |
| P2 repository index | Every process rewrites the index | Serialized by a lock; a shared index of two repositories is reported ([4.5](#45-cross-process-locks-in-bnd)) |
| Launch storage (`-runstorage`) | A second launch deletes storage that is in use | The second launch fails with a message; separate directories need `${driver}` ([2](#2-set-up-parallel-use)) |
| `cnf/cache` | Shared downloads and expanded JARs | Unchanged; see [limits](#5-limits) |

The locks are part of bnd, not of this extension. They are proposed upstream in [bndtools/bnd#7533](https://github.com/bndtools/bnd/pull/7533). The language server and the Java project import bundled with this extension contain them. Eclipse takes part once its Bndtools version contains them; until then only the VS Code side locks, which has no effect on Eclipse.

## 2. Set up parallel use

1. Open the bnd workspace in VS Code while Eclipse has it open. The extension shows an **Eclipse** item in the status bar and a notification when it [detects Eclipse](#41-detection).
2. Run **bnd: Configure Parallel Use with Eclipse...** (also offered by the notification and the status bar item) and confirm. It creates `cnf/ext/vscode-outputs.bnd`, clears `java.project.resourceFilters` in the workspace settings, and removes the classpath container that earlier extension versions wrote into Eclipse `.classpath` files. Details are in the [README](../README.md#parallel-use-with-eclipse-bndtools).
3. Add `bin.vscode/`, `bin_test.vscode/`, and `generated.vscode/` to `.gitignore`.
4. Give each tool its own launch storage. In every `.bndrun` that sets `-runstorage` or `launch.storage.dir`, put `${driver}` into the directory, for example:

   ```properties
   storage: ${.}/rt/${driver}/app
   -runstorage: ${storage}
   ```

   Eclipse then uses `rt/eclipse/app`, VS Code `rt/vscode/app`, and the bnd command line `rt/bnd/app`. Properties such as `launch.storage.dir`, `osgi.instance.area`, or a P2 data area must follow the same directory. The configuration command lists the `.bndrun` files that still share storage.
5. In Eclipse, enable **Preferences → General → Workspace → Refresh using native hooks or polling**, so that edits made in VS Code are noticed.
6. Give every P2 repository its own index `location`. Two repositories with different URLs and one index file rewrite each other's index; bnd with the locks reports this as an error.

To stop the bnd language server for a workspace instead, set `bnd.server.enabled` to `false` or use the **bnd LS** status bar item. This removes the language server as a writer. It does not affect the Java project import.

## 3. Why the tools collide

- Eclipse Bndtools, the bnd language server, the Java language server with the bnd adapter, and a command line build are separate processes. Each evaluates the bnd configuration on its own.
- The locks inside bnd (`WorkspaceLock`, repository and plugin synchronization) are `java.util.concurrent` locks. They coordinate threads of one process, not processes.
- bnd repositories create indexes and download artifacts when they are first read. A process that only offers completion therefore also writes.
- Derived directories are named by the workspace configuration (`bin`, `testbin`, `target-dir`, `-runstorage`), which is the same for every process unless the configuration distinguishes them.

## 4. How it works

### 4.1 Detection

Eclipse writes `.metadata/.lock_info` into its workspace location with its host name and process id. For each open workspace folder that contains `cnf/build.bnd`, the extension reads that file and reports Eclipse when the process is running on this machine. The file stays behind when Eclipse exits, so the process check is what decides.

This covers the layout where the Eclipse workspace location is the bnd workspace root. It does not cover an Eclipse workspace elsewhere that imports the projects, or Eclipse versions that do not write `.lock_info`. A process id that the operating system has reused produces a false report.

### 4.2 Separate output by driver

bnd names the hosting tool with the `${driver}` macro: Bndtools is `eclipse`, the command line is `bnd`. The extension passes `vscode` to its bundled language server, and the bundled Java project import reports `vscode` as well. The generated `cnf/ext/vscode-outputs.bnd` uses this:

```properties
vscode.outputs: ${if;${driver;vscode};.vscode}
bin: bin${vscode.outputs}
testbin: bin_test${vscode.outputs}
target-dir: generated${vscode.outputs}
```

For every driver except `vscode` the macro is empty, so Eclipse, the command line, and Gradle keep `bin`, `bin_test`, and `generated`. VS Code compiles into `bin.vscode` and `bin_test.vscode` and builds bundles into `generated.vscode`. Both tools build; neither waits for the other. A bundle launched from VS Code is the VS Code build.

### 4.3 Java project import of Eclipse projects

A project counts as managed by Eclipse Bndtools when its `.project` names the Bndtools nature. For such a project the bnd adapter in the Java language server:

- does not change natures, builders, or compiler settings;
- sets the classpath in memory only (JDT's `setRawClasspath` with `canModifyResources` false), so `.classpath` is not written;
- applies that classpath again when Eclipse rewrites `.classpath`, because JDT then returns to the file;
- resolves the Bndtools container `aQute.bnd.classpath.container`, so the file's own classpath also works.

Projects without Eclipse metadata are imported as before. The Java language server itself adds a resource filter to `.project` unless `java.project.resourceFilters` is empty; the configuration command clears that setting for the workspace.

### 4.4 Language server switch

`bnd.server.enabled`, **bnd: Enable/Disable Language Server**, and the **bnd LS** status bar item start and stop the bnd language server per workspace. The bnd CLI commands, syntax highlighting, the bnd Explorer, and the JAR tree work without it.

### 4.5 Cross-process locks in bnd

[bndtools/bnd#7533](https://github.com/bndtools/bnd/pull/7533) adds a lock that excludes other processes and that the operating system releases when the owning process ends, also after a crash.

| Operation | Lock file | When another process holds it |
|---|---|---|
| Validate, create, or refresh a P2 index | `<index file name>.lock` in the repository's `cache` directory | Wait, then use the index that was written. Continue without the lock after 10 minutes. |
| Build or clean a project | `cnf/cache/locks/<project>.lock` | Wait. Continue with a warning after 2 minutes. |
| Run a framework with a storage directory | `<storage directory>.lock` next to the directory | The launch fails and names the holder. Nothing is deleted. |

The locks are advisory. A bnd version without them neither takes nor honors them.

## 5. Limits

- **Launch storage** is only separated when the `.bndrun` uses `${driver}` or `${target-dir}`. Without that, and with a launcher on the Eclipse side that does not take the storage lock, a second launch can still delete storage that is in use.
- **`cnf/cache`** is shared. The versioned workspace cache and the HTTP download cache have no cross-process lock.
- **Eclipse sees the VS Code directories** `bin.vscode`, `bin_test.vscode`, and `generated.vscode` as ordinary folders of its projects.
- **A project that defines `bin`, `testbin`, or `target-dir` in its own `bnd.bnd`** keeps those directories in both tools.
- **Java output without the configuration**: the Java language server compiles Eclipse projects into `bin`, as Eclipse does.
- **Bndtools marker update**: saving in a bnd editor while files change can log `The resource tree is locked for modifications` from the property-conflict markers. This is a scheduling defect in Bndtools, independent of VS Code, and not addressed here.
- **Verification**: the Java project import was run against a real Java language server, and the locks against a second process. The complete setup with a running Eclipse was not run.

## 6. Design background

Four designs were considered for parallel use.

| Design | Idea | Status |
|---|---|---|
| **A. Twin** | Each tool has its own derived state, selected by `${driver}` | Implemented for compiler and bundle output (4.2, 4.3); launch storage by configuration |
| **B. Follower** | One tool owns the build, the others only read | Reduced to detection and display of a parallel Eclipse (4.1); no ownership protocol |
| **C. Hosted** | Bndtools hosts the bnd language server; VS Code connects to it | Not started; would need changes in Bndtools and the server |
| **D. Foundation** | bnd coordinates writes to shared files across processes | Implemented in bndtools/bnd#7533 (4.5) |

A needs the workspace configuration to opt in; the extension writes it. B without an ownership protocol cannot stop a second writer, which is why the extension offers A as soon as it detects Eclipse. C removes the second bnd model altogether and remains the option when two models prove too costly.

## 7. Verification

| What | How |
|---|---|
| Eclipse project metadata is unchanged by the import | `npm run test:jdtls`: a project with Bndtools `.project`, `.classpath`, and `.settings` is imported by a real Java language server; the files are compared before and after import, after the output configuration, and after a rewrite of `.classpath`. The check fails with the adapter of extension 0.27.2. |
| Output follows the driver | The same run asserts `bin.vscode` on the classpath and a compiled class file there. A language server unit test and an extension test with the bundled server evaluate `${bin}`, `${testbin}`, and `${target-dir}` before and after the file is created and removed. |
| Detection, generated file, refusal, cleanup | Extension unit tests on temporary workspaces |
| Locks | bnd tests: a second JVM holding a lock and being killed; P2 index waiting and timeout; build and clean waiting; a launch that fails while the storage is locked and leaves it untouched |
