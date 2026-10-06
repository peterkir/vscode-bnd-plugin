# Run and Debug OSGi Frameworks

The extension launches `.bndrun` files and bnd projects through the VS Code **Run and Debug** facility. The Java bnd Language Server computes the launch (main class, class path, `-runvm`, `-runprogramargs`, `-runenv`, working directory) with bnd's `ProjectLauncher`, and the **Debugger for Java** extension starts the JVM. Breakpoints, stepping, variables, and the Debug Console work as for any Java program.

## Requirements

- A trusted workspace.
- `bnd.server.mode` set to `java` (or `socket` with a server that supports `bnd.launch.prepare`). The Node fallback server cannot launch.
- The [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) extension and Language Support for Java. The bundled adapter imports bnd projects directly into JDT LS, including source/test roots and build/test dependencies. Native import requires Red Hat Java 1.56 or later and Java 21 or later for JDT LS, separate from the launched framework's `-runee`.
- Valid `java.configuration.runtimes` names, such as `JavaSE-21` or `JavaSE-25`. After adding native import to an existing workspace, run **Java: Clean Java Language Server Workspace** and allow reimport.

For later classpath changes, use **Java: Reload Projects** without clearing the workspace. Check `java.configuration.updateBuildConfiguration` for automatic updates or interactive approval.

## Starting a Launch

- **CodeLens** — **Run OSGi** / **Debug OSGi** at the top of a `.bndrun` file or a `bnd.bnd` with `-runfw`/`-runbundles`; **Run OSGi tests** / **Debug OSGi tests** on files with `-testpath`. Disable with `bnd.launch.codeLens`.
- **Editor title run menu** and the context menu of the **Explorer** and **bnd Explorer** on `.bndrun` and `bnd.bnd` files.
- **Command Palette** — **Bnd: Run OSGi Framework**, **Bnd: Debug OSGi Framework**, **Bnd: Run OSGi Tests (Launch)**, **Bnd: Debug OSGi Tests**. They launch the active `.bndrun` or `bnd.bnd` editor; from any other editor they let you pick one of the workspace's launch files.
- **F5** with a `.bndrun` or `bnd.bnd` file open and no `launch.json`.
- **Run and Debug view** — choose **bnd OSGi** to list every `.bndrun` file and test project in the workspace.

## Launch Configuration

```json
{
  "type": "bnd",
  "request": "launch",
  "name": "bnd: app.bndrun",
  "target": "${workspaceFolder}/my.project/app.bndrun",
  "kind": "run",
  "vmArgs": ["-Xmx1g"],
  "buildBeforeLaunch": true
}
```

| Attribute | Description |
|-----------|-------------|
| `target` | `.bndrun` or `bnd.bnd` file. Default `${file}`. |
| `kind` | `run` launches the framework; `test` runs OSGi tests through the bnd tester. |
| `tests` | Test names for `kind: test`, e.g. `com.example.FooTest` or `com.example.FooTest:testBar`. Empty runs all tests. |
| `vmArgs`, `args`, `env` | Appended to `-runvm`, `-runprogramargs`, and `-runenv`. |
| `console` | `integratedTerminal` (default, supports the Gogo shell), `internalConsole`, or `externalTerminal`. |
| `buildBeforeLaunch` | Build the project and its workspace dependencies first. Default `true`. |
| `javaExec` | Java executable. Defaults to the bnd `java` property, then a runtime matching `-runee` from `java.configuration.runtimes`, `bnd.cli.javaExecutable`, `JAVA_HOME`, or `PATH`. |
| `shortenCommandLine` | Passed to the Java debugger. Default `auto`. |
| `sourcePaths` | Additional debugger source roots appended to sources of launched workspace bundles. |
| `projectName` | Optional imported Java project used by the Java debugger. |

`-runjdb` is ignored because the Java debugger owns the JDWP connection. Temporary launcher files are deleted when the debug session ends.
