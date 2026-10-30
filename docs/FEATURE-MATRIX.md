# bnd Tooling Feature Matrix

Comparison of bnd capabilities across the bnd CLI, Bndtools (Eclipse), this VS Code extension, the bnd Language Server, the bnd MCP server, the bnd Gradle plugins, and the bnd Maven plugins.

Sources reviewed:

- bnd master `7603bcd58` (2026-10-28, `base.version` 7.6.0): `biz.aQute.bnd/src/aQute/bnd/main/*`, `bndtools.*`, `org.bndtools.*`, `gradle-plugins/`, `maven-plugins/`
- bnd Language Server `biz.aQute.bnd.lsp` + `org.bndtools.jdtls.adapter`: branch `fea-bnd-ls` `84bda2cf9` (2026-10-30), rebased onto remote master `3b32420170`; includes clean/baseline/resolve dry-run commands
- bnd MCP server `biz.aQute.bnd.mcp`: branch `fea-mcp` `cc78a7b9c` (2026-10-16) plus uncommitted readiness-mode change (2026-10-30)
- VS Code extension `0.27.1` with bundled language server `7.6.0.202610301013`

Column meaning:

- **CLI** — `bnd` command line (`biz.aQute.bnd`)
- **Bndtools** — Eclipse IDE plugins
- **VS Code** — this extension (client side; uses LSP column for server work)
- **LSP** — `biz.aQute.bnd.lsp` standard LSP capabilities and `workspace/executeCommand` ids (`bnd.*`)
- **MCP** — `biz.aQute.bnd.mcp` tools (`bnd_*`) for AI agents, stdio transport
- **Gradle** — `biz.aQute.bnd.gradle` plugins / task types
- **Maven** — `bnd-*-maven-plugin` goals

Legend: ✓ full · ◐ partial / indirect · ✗ missing · – not applicable to this tool kind

## 1. Workspace and project scaffolding

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Create workspace (`cnf/`) | ✓ `add workspace` | ✓ wizard | ✓ `bnd.wizard.createWorkspace` | ✓ `bnd.wizard.create` (+ legacy `plan`/`apply`/`dispose`) | ✓ `bnd_workspace_create` (idempotent, keeps existing files) | – | – |
| Workspace template fragments (workspace-templates index) | ✓ `add fragment` | ✓ fragments wizard | ✓ `bnd.wizard.addFragment`, required-fragment closure, index URL management | ✓ `bnd.wizard.templates.list` (catalogs, `requires`, archived, official) | ✓ `bnd_fragments_list`, `bnd_workspace_create fragments=[...]`, `trustThirdParty` | – | – |
| Git-repo / Mustache project templates (`org.bndtools.templating`) | ✗ | ✓ | ✗ | ✗ | ✗ | – | – |
| Create project | ✓ `add project` | ✓ New Bnd OSGi Project (DS, API, api/impl/consumer) | ✗ | ✗ | ✗ | – | – |
| Add / remove plugin to workspace | ✓ `add plugin`, `remove plugin` | ✓ Plugins UI | ✗ | ✗ | ✗ | – | – |
| Remove project / workspace | ✓ `remove` | ✓ (Eclipse delete) | ◐ explorer delete only | ✗ | ✗ | – | – |
| New `.bnd` / `.bndrun` / `package-info.java` / Blueprint / DS component wizards | ✗ | ✓ | ✗ (plain New File) | ✗ | ✗ | – | – |
| Import / describe existing workspace | – | ✓ wizard | ✓ `bnd.wizard.importWorkspace` | ◐ implicit via `cnf/build.bnd` discovery (`BndWorkspaceManager`) | ✓ `bnd_workspace_describe` (projects, bndruns, repositories, diagnostics) | – | – |
| Convert Java project / add or remove bnd nature | – | ✓ | – | ◐ JDT-LS adapter imports bnd projects (`BndProjectImporter`) | – | – | – |
| PDE `.launch` to bndrun, Eclipse `.classpath` info | ✓ `eclipse` | ✓ Generate bndrun from .launch | ✗ | ✗ | ✗ | – | – |
| Workspace sync / cache refresh | ✓ `sync` | ✓ Refresh | ◐ repositories refresh | ✓ `bnd.repositories.reload` | ✗ | – | – |
| Install build tool (`-buildtool`) | ✓ `buildtool` | ✗ | ✗ | ✗ | ✗ | – | – |
| Workspace trust gate | – | – | ✓ VS Code trust | ✓ `initializationOptions.workspaceTrusted` gates properties, launch, repositories, wizard | ◐ `trustThirdParty` for fragments only | – | – |

## 2. Build

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Build project | ✓ `build`, `project`, `do` | ✓ incremental builder | ◐ `bnd.cli.build` (terminal) + `bnd.lsp.buildProject` | ✓ `bnd.build.project` (`builtFiles`, errors, warnings) | ✓ `bnd_build` (`outputs`, diagnostics) | ✓ `jar` | ✓ `bnd-process` |
| Build workspace | ✓ `build` (workspace), `__par` | ✓ | ✗ | ✓ `bnd.build.workspace` | ✗ (per project) | ✓ `*Dependencies`, `*Needed` | ✓ reactor |
| Watch / live build | ✓ `build --watch`, `dev` | ✓ auto build | ◐ watch mode via CLI | ◐ diagnostics on change (300 ms debounce) | ✗ | ✗ (Gradle `-t`) | ✗ |
| Clean | ✓ `clean` | ✓ | ✓ `bnd.cli.clean` | ✓ `bnd.build.clean` (project file URI cleans project, workspace file URI cleans all projects) | ✗ | ✓ `clean*` | ✓ (mvn) |
| Non-workspace bundle build (bnd instructions on plain JAR) | ✓ `create`, `wrap` | – | – | – | – | ✓ `Bundle` task / `biz.aQute.bnd.builder` | ✓ `bnd-process` |
| Source generation (`-generate`) | ✓ `generate` | ✓ participant + markers | ✗ | ✗ | ✗ | ✓ (within jar) | ✓ `generate`, `generate-test` |
| Compile outside build tool | ✓ `compile`, `junit` | – | ✗ | ◐ `bnd-javac` diagnostics from `ProjectBuilder` | ✗ | – | – |
| Error markers / diagnostics | ✓ console | ✓ 9 marker types, error-detail handlers | ✓ shows LSP diagnostics | ✓ `publishDiagnostics`: property conflicts, build, verifier, `bnd-javac` | ✓ `diagnostics` in every result | ✓ build log | ✓ build log |
| Quick fixes | ✗ | ✓ buildpath, packageinfo baseline, include conflict, missing workspace, DS annotation refactors, AI refactorer | ✓ shows LSP code actions | ◐ `bnd.propertyconflict` (rename suffix / remove), `bnd.bundleactivator` (remove), `bnd.bundleversion` (set suggested) | ✗ | ✗ | ✗ |
| Show plugins / deliverables / dependencies | ✓ `plugins`, `deliverables`, `dependencies` | ◐ | ✗ | ✗ | ◐ `bnd_workspace_describe` | ✓ `echo`, `bndproperties` | ✗ |

## 3. Repositories and dependencies

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| List repositories / bundles / versions | ✓ `repo repos`, `repo list`, `repo versions` | ✓ Repositories view | ✓ Repositories view (filter, wildcards) | ✓ `bnd.repositories.list`, `.bundles`, `.versions`, `bnd.repo.list` | ◐ repository names only (`bnd_workspace_describe`) | ✗ | ✗ |
| P2 feature detail | ✓ (P2Repository) | ✓ | ✓ features with included/required | ✓ `bnd.repositories.feature` | ✗ | ✗ | ✗ |
| Capability / package / service search | ✓ `resolve find`, `select` | ✓ Repositories search | ✓ Advanced Search (package, service, LDAP) | ✓ `bnd.repositories.search` | ✗ | ✗ | ✗ |
| Get / put / copy artifacts | ✓ `repo get`, `repo put`, `repo copy` | ✓ add, drag-drop, remove resource | ◐ Add Bundles, Download; no remove | ✓ `bnd.repositories.get`, `.fetch`, `.put` | ✗ | ✗ | ✗ |
| Repository plugin actions (`Actionable`) | ✗ | ✓ context menu | ✓ Repository Actions | ✓ `bnd.repositories.actions`, `.runAction` | ✗ | ✗ | ✗ |
| Refresh / offline mode | ✓ `repo refresh` | ✓ Shift+Ctrl+F | ✓ Refresh, Work Offline/Online | ✓ `bnd.repositories.reload`, `bnd.workspace.offline` | ✗ | ✗ | ✗ |
| Drag bundle into `-buildpath` / `-runbundles` | – | ✓ | ✓ | – | – | – | – |
| Bundle completion in path instructions | – | ◐ | ✓ via LSP | ✓ workspace repository bundles + versions for `-buildpath`, `-runpath`, `-testpath` | – | – | – |
| Maven Bnd Repository GAV maintenance | ✓ `mbr repos`, `mbr verify`, `mbr check`, `mbr update` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Create OSGi index | ✓ `index`, `repo index` | ✓ Generate OSGi Repository Index | ✗ | ✗ | ✗ | ✓ `Index` | ✓ `index`, `local-index` |
| Index validation / diff | ✓ `resolve validate`, `xmlrepodiff` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Nexus / staging operations | ✓ `nexus` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Repository dependency export (license / IP) | ✓ `repo deps`, `repo topom` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `-buildpath` classpath container | – | ✓ JDT container | ◐ via JDT-LS adapter | ✓ JDT-LS adapter `org.bndtools.jdtls.BND_CONTAINER`, `BuildSupport` | – | ✓ Gradle configurations | ✓ Maven scopes |
| HTTP client settings / cache | ✓ `com info`, `com clear`, `com settings`, `settings` | ◐ preferences | ✗ | ✗ | ✗ | – | – |

## 4. Resolution

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Resolve bndrun, write `-runbundles` | ✓ `resolve resolve -W` | ✓ Run tab Resolve (Ctrl+R) | ✓ `bnd.cli.resolve` (multi-file) + `bnd.lsp.resolve` | ✓ `bnd.resolve [uri, writeChanges=true]` returns `changed`, `written` | ✓ `bnd_resolve` (`writeChanges` flag) | ✓ `Resolve`, `resolve.<name>` | ✓ `resolve` |
| Verify `-runbundles` unchanged | ✓ (exit code) | ◐ | ✗ | ◐ dry run via `writeChanges=false` + `changed` | ◐ dry run via `writeChanges=false` | ✓ `failOnChanges` | ✓ `verify` |
| Requirement / capability analysis | ✓ `print -c`, `graph` | ✓ Resolution view | ✓ Resolution panel (match, filter, optional, unresolved) | ✓ `bnd.resolution.analyze` (`.bnd`/`.jar`, max 100) | ✗ | ✗ | ✗ |
| Bundle dependency graph | ✓ `resolve dot`, `graph` | ✓ Bundle Graph view | ✗ | ✗ | ✗ | ✗ | ✗ |
| Analyze bndrun (unused / unreachable) | ✗ | ✓ Analyze bndrun | ✗ | ✗ | ✗ | ✗ | ✗ |
| Resolve result diff / report optional | ✓ | ✓ wizard diff | ✗ | ✗ | ✗ | ✓ `reportOptional` | ✓ `reportOptional` |

## 5. Launch and debug

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Run bndrun / project | ✓ `run` | ✓ OSGi Framework launch | ✓ CodeLens, Run view, F5, `bnd.cli.run` | ✓ `bnd.launch.prepare` (main class, classpath, vm/program args, env, cwd, java) + `bnd.launch.dispose` | ✓ `bnd_run_start` (child JVM, free HTTP port, readiness `http` / `console` + `readyPattern` / `none`), `bnd_run_stop`, `bnd_run_status` (console ring buffer) | ✓ `Bndrun`, `run.<name>` | ✓ `run` |
| Debug with JDWP | ✓ `-runjdb` | ✓ Eclipse debugger | ✓ Debugger for Java (`kind: run`) | ◐ provides config; debugger is client side | ✗ | ✗ | ✗ |
| Hot code replace / dynamic bundle update | – | ✓ | ✗ (JDWP HCR only) | ✗ | ✗ | – | – |
| Source lookup for dependencies | – | ✓ 4 source containers | ◐ `sourcePaths`, JDT-LS adapter | ◐ `sourcePaths` in prepare result | ✗ | – | – |
| Build-before-launch check | – | ✓ | ✓ `buildBeforeLaunch` | ✓ `build` flag in `bnd.launch.prepare` | ◐ resolves before start | ✓ task dependencies | ✓ lifecycle |
| Smoke-test running app over HTTP | ✗ | ✗ | ✗ | ✗ | ✓ `bnd_http_get` (loopback only, status/body expectation, retry) | ✗ | ✗ |
| Native launcher / applaunch | ✗ | ✓ bnd Native Launcher | ✗ | ✗ | ✗ | ✗ | ✗ |
| Executable JAR packaging to run | ✓ `package` | ✓ export | ✓ `bnd.cli.export` | ✗ | ✗ | ✓ `Export` | ✓ `export` |
| Launchpad (in-JVM framework for tests) | library | library | ✗ | ✗ | ✗ | library | library |

## 6. Testing

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Run OSGi tests (tester / junit-platform) | ✓ `test`, `runtests` | ✓ OSGi JUnit launch | ✓ CodeLens tests, `kind: test`, `tests` filter, `bnd.cli.test`, `bnd.cli.runtests` | ✓ `bnd.launch.prepare kind=test tests=[...]` (`ProjectTester`) | ✗ | ✓ `TestOSGi`, `testOSGi`, `testrun.<name>` | ✓ `testing` |
| Debug OSGi tests | ✓ `-runjdb` | ✓ | ✓ | ◐ config only | ✗ | ✗ | ✗ |
| Test report XML / HTML | ✓ `runtests` | ✓ JUnit view | ◐ reports on disk | ✗ | ✗ | ✓ `resultsDirectory` | ✓ `reportsDir` |
| Continuous testing | ✓ `-testcontinuous` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Plain JUnit outside OSGi | ✓ `junit` | ✓ Eclipse | – (Java extension) | – | ✗ | ✓ `test` | ✓ surefire |

## 7. Export, packaging, distribution

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Executable JAR export | ✓ `export -E bnd.executablejar`, `package` | ✓ wizard | ✓ `bnd.cli.export` (picker) | ✗ | ✗ | ✓ `export.<name>` | ✓ `export` |
| Runbundles export | ✓ `-E bnd.runbundles` | ✓ | ◐ via same command | ✗ | ✗ | ✓ `runbundles.<name>` | ✓ `bundlesOnly` |
| P2 repository / feature export | ✓ `export` (p2 exporter) | ✓ `org.bndtools.p2` | ◐ via CLI only | ✗ | ✗ | ◐ exporter parameter | ◐ exporter parameter |
| Subsystem export | ✓ | ✓ | ◐ | ✗ | ✗ | ◐ | ◐ |
| Wrap non-OSGi JAR | ✓ `wrap` | ✗ | ✓ `bnd.cli.wrap` | ✗ | ✗ | ✓ `Bundle` task | ✓ `bnd-process` |
| Flatten / collect / extract / type / create JAR | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Profile JARs | ✓ `profile` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Patch (binary diff / apply) | ✓ `patch` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Attach artifact to build | – | – | – | – | – | ✓ (archives) | ✓ `attach` |

## 8. Versioning, baseline, release

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Baseline against previous release | ✓ `baseline` | ✓ builder markers + quick fix | ◐ `bnd.cli.baseline`; Bundle-Version quick fix via LSP | ✓ `bnd.baseline` (per sub-bundle: versions, suggested version, package deltas) + `bnd.bundleversion` diagnostic + fix | ✗ | ✓ `Baseline` | ✓ `baseline` |
| Bump version | ✓ `bump` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (versions-maven-plugin) |
| Release to `-releaserepo` | ✓ `release` | ✓ Release Bundles wizard | ◐ `bnd.cli.release` (confirmation, terminal) | ✗ | ✗ | ✓ `release*` | – (mvn deploy) |
| Diff two bundles | ✓ `diff` | ✓ release wizard diff | ✓ `bnd.cli.diff` | ✗ | ✗ | ✓ baseline report | ✓ `fullReport` |
| `packageinfo` version editor | – | ✓ | ✗ | ✗ | – | – | – |
| Changes log | ✓ `changes` | ✗ | ✗ | ✗ | ✗ | – | – |

## 9. Bundle inspection and analysis

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Print manifest / imports / exports / capabilities / DS / metatype | ✓ `print` | ✓ JAR editor Print page | ✓ `bnd.cli.print` + JAR Viewer Print page | ✓ `bnd.jar.print` (manifest map), `bnd.jar.printText` (full `JarPrinter` report) | ✗ | ✗ | ✗ |
| Browse JAR entries | ✓ `view`, `type` | ✓ JAR editor Tree | ✓ JAR Viewer Tree (encoding, 1 MB limit) | ◐ client reads ZIP; print via LSP | ✗ | ✗ | ✗ |
| Verify bundle | ✓ `verify` | ✓ build | ✓ `bnd.cli.verify` | ◐ `Verifier` errors as diagnostics | ✗ | ✓ (bnd warnings) | ✓ |
| Cross-reference / class graph | ✓ `xref`, `graph`, `select` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Execution environments of JAR | ✓ `ees` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Digest / grep in JARs | ✓ `digest`, `grep` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Imports / Exports visual page | – | ✓ | ✗ | ✗ | – | – | – |
| Effective / merged properties | ✓ `properties`, `macro` | ✓ Effective source page | ✓ Effective Properties editor (expanded / merged / provenance) + `bnd.cli.properties`, `bnd.cli.macro`, `bnd.lsp.expandMacro` | ✓ `bnd.properties.effective` (unsaved snapshot, provenance, `effectiveSource`, stale-version error), `bnd.macro.expand` | ✗ | ✓ `bndproperties` | ✗ |
| Schema / syntax database | ✓ `syntax`, `schema` | ◐ completion | ✓ CLI reference panel (77 commands) | ✓ `Syntax.HELP` drives completion/hover | ✗ | ✗ | ✗ |

## 10. Editing and language support

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Syntax highlighting | – | ✓ | ✓ TextMate (`.bnd`, `.bndrun`, `.mvn`) + semantic tokens | ✓ `semanticTokens/full` (keyword, property, variable, string, number, comment, macro, operator, type) | – | – | – |
| Completion for instructions / headers / macros | – | ✓ `BndCompletionProcessor` | ✓ via LSP (Node fallback: static 153/138/48 lists) | ✓ triggers `- : = $ { ; ,`; `Syntax.HELP`, macros, repository bundles, Java versions, booleans | – | – | – |
| Hover documentation | – | ✓ `BndHover` | ✓ via LSP | ✓ header docs, merged-instruction suffix explanation, macro context | – | – | – |
| Form-based editor pages (Contents, Build, Run, Test, Bundle Description) | – | ✓ | ✗ (text only) | ✗ | – | – | – |
| Outline / document symbols | – | ✓ | ✓ via LSP | ✓ `documentSymbol` (properties, clauses) | – | – | – |
| Folding | – | ✓ | ✓ via LSP | ✓ `foldingRange` (continuation lines) | – | – | – |
| Go-to-definition | – | ✗ | ✓ via LSP | ✓ `-include` targets, workspace `-buildpath` projects | – | – | – |
| References / rename / formatting | – | ✗ | ✗ | ✗ (formatting advertised false) | – | – | – |
| Package decorators (exported `+`, DS icon) | – | ✓ | ✗ | ✗ | – | – | – |
| Project explorer with bnd filters | – | ✓ Bndtools Explorer, working sets, perspective | ✓ bnd Explorer (file operations, exclude, drag-drop) | – | – | – | – |
| Walkthrough / onboarding | – | ✗ | ✓ 8 walkthroughs | – | – | – | – |
| Fallback when Java missing | – | – | ✓ Node LSP (completion / hover only) | – | – | – | – |
| Transport | – | – | stdio / socket client | ✓ stdio, TCP socket | ✓ stdio (JSON-RPC 2.0, MCP SDK 2.0.1) | – | – |

## 11. Remote agent and deployment

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Remote agent list / start / stop / install / uninstall / ping / framework / revisions | ✓ `remote` | ◐ Remote Bundle Install | ✗ | ✗ | ✗ | ✗ | ✗ |
| Create distro from running framework | ✓ `remote distro` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Interactive shell | ✓ `shell`, `action`, `debug` | – | ✗ | – | – | – | – |
| Managed child process lifecycle for agents | – | – | ◐ debug session | ◐ launch session retained until `bnd.launch.dispose` | ✓ `runId` sessions, stop on shutdown | – | – |

## 12. Reporting and documentation

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Reports (workspace / project / JAR, templates) | ✓ `exportreport list`, `export`, `jarexport` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ `bnd-reporter-maven-plugin:export` |
| README generation | ✓ `exportreport readme`, `jarreadme` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ `bnd-reporter-maven-plugin:readme` |
| CLI manual / markdown generation | ✓ `gmd`, `generatemanual`, `help`, `bash` | – | ◐ CLI Reference webview | – | – | – | – |
| Maven POM operations | ✓ `maven`, `repo topom` | ✗ | ✗ | ✗ | ✗ | – | native |

## 13. Tool integration

| Feature | CLI | Bndtools | VS Code | LSP | MCP | Gradle | Maven |
|---|---|---|---|---|---|---|---|
| Gradle headless build | – | ✓ `org.bndtools.headless.build.plugin.gradle` | ✗ | ✗ | ✗ | native | – |
| Ant build | ✓ `biz.aQute.bnd.ant` | ✓ `org.bndtools.headless.build.plugin.ant` | ✗ | ✗ | ✗ | – | – |
| m2e / Maven project configurator | – | ✓ `bndtools.m2e` | ✗ | ✗ | ✗ | – | native |
| PDE target platform from bnd repositories / bndrun | ✓ `biz.aQute.bnd.pde` | ✓ `bndtools.pde` | ✗ | ✗ | ✗ | – | – |
| VCS ignore management (`.gitignore`) | ✗ | ✓ | ✗ | ✗ | ✗ | – | – |
| Java debugger / JDT integration | – | native | ✓ JDT-LS adapter (JDK 21, Red Hat Java 1.56+) | ✓ `org.bndtools.jdtls.adapter` (importer, classpath container, build support) | – | – | – |
| AI assistant integration | – | ◐ OpenAI refactorer view | ◐ via MCP server (external) | ✗ | ✓ purpose-built tool surface with structured diagnostics | – | – |
| Bundled tool management (download, version pin, SHA-256, snapshot) | – | – | ✓ LSP JAR + CLI JAR + Java runtime discovery | – | – | ✓ plugin version | ✓ plugin version |
| Configuration cache / CI friendly | – | – | – | – | – | ✓ | ✓ |

## Gaps: VS Code extension vs. Bndtools

- No project wizard (`add project`), no DS / API / file templates, no plugin management UI.
- No form editors (Contents / Build / Run tabs), Imports / Exports page.
- Diagnostics limited to property conflicts plus three quick fixes; no buildpath quick fix, no DS annotation refactors, no `-include` conflict fix.
- No Bundle Graph, no bndrun Analyze, no native launcher, no hot bundle update.
- No release wizard with diff, no `packageinfo` editor.
- Remote agent, reporter, mbr, nexus, PDE, m2e integrations absent.

## Gaps: LSP server vs. Bndtools / CLI

- No references, rename, or formatting; no export, release, bump, index, remote.
- Quick fixes limited to three diagnostic codes.
- VS Code extension does not yet expose `bnd.build.clean`, `bnd.baseline`, or the resolve dry-run flag.

## Gaps: MCP server vs. LSP / CLI

- No test execution, no export, no baseline, no repository browsing (names only), no properties/macro evaluation, no JAR inspection.
- Build is per project only; no workspace build, no clean.
- Tools only; no MCP resources or prompts.

## Gaps: VS Code extension vs. bnd CLI

CLI commands not wired to a VS Code command (reachable only via terminal or the CLI Reference panel):

`add`, `remove`, `bump`, `dev`, `package`, `remote`, `mbr`, `nexus`, `index`, `xmlrepodiff`, `exportreport`, `graph`, `xref`, `select`, `ees`, `digest`, `grep`, `flatten`, `collect`, `extract`, `profile`, `patch`, `sync`, `eclipse`, `generate`, `deliverables`, `dependencies`, `plugins`, `com`, `settings`, `syntax`, `schema`, `shell`.

## Appendix A: bnd CLI top-level commands (master)

`action add baseline bash bnd bootstrap bsn2url build buildtool buildx bump changes classpath classtoresource clean collect com compile convert copy create debug defaults deliverables dependencies dev diff digest do eclipse ees export exportreport extract find flatten generate generatemanual gmd graph grep index info junit macro maven mbr nexus package packagetoresource plugins print profile project properties release remote remove repo resolve run runtests schema select settings shell source sync syntax test type verify version view wrap xmlrepodiff xref`

## Appendix B: LSP `workspace/executeCommand` ids (`fea-bnd-ls`)

Build: `bnd.build.project`, `bnd.build.workspace`, `bnd.build.clean`, `bnd.resolve`, `bnd.baseline`, `bnd.macro.expand`
JAR / repo: `bnd.jar.print`, `bnd.jar.printText`, `bnd.repo.list`
Properties / resolution: `bnd.properties.effective`, `bnd.resolution.analyze`
Launch: `bnd.launch.prepare`, `bnd.launch.dispose`
Repositories: `bnd.repositories.list`, `.bundles`, `.versions`, `.feature`, `.get`, `.search`, `.actions`, `.runAction`, `.reload`, `.put`, `.fetch`, `bnd.workspace.offline`
Wizard: `bnd.wizard.templates.list`, `bnd.wizard.plan`, `bnd.wizard.apply`, `bnd.wizard.create`, `bnd.wizard.dispose`

Diagnostic codes with quick fixes: `bnd.propertyconflict`, `bnd.bundleactivator`, `bnd.bundleversion`.

## Appendix C: MCP tools (`fea-mcp`)

`bnd_fragments_list`, `bnd_workspace_create`, `bnd_workspace_describe`, `bnd_build`, `bnd_resolve`, `bnd_run_start`, `bnd_run_stop`, `bnd_run_status`, `bnd_http_get`
