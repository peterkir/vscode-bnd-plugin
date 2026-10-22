#!/usr/bin/env node
// Generates the documentation screenshots in docs/images by driving an
// Extension Development Host with Playwright (playwright-core, not a project
// dependency: `npm install --no-save playwright-core`).
//
//   node scripts/screenshots.mjs [--only name,name] [--keep]
//
// Environment:
//   VSCODE_EXECUTABLE_PATH  Electron binary of a VS Code installation
//                           (default: /Applications/Visual Studio Code.app/Contents/MacOS/Code)
//   BND_DEMO_WORKSPACE      existing bnd workspace used for editor, repository,
//                           JAR viewer, and launch screenshots (read-only)
//   BND_SHOT_DIR            output directory (default: docs/images)
//   BND_SHOT_DEBUG          forward renderer console output to this process

import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.BND_SHOT_DIR ?? path.join(repoRoot, 'docs', 'images');
const only = (process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length) ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
const keep = process.argv.includes('--keep');
const executablePath = process.env.VSCODE_EXECUTABLE_PATH
    ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const demoWorkspace = process.env.BND_DEMO_WORKSPACE;
const WIDTH = 1440;
const HEIGHT = 900;

fs.mkdirSync(outDir, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-shots-'));
const userDataDir = path.join(scratch, 'user-data');
const extensionsDir = path.join(scratch, 'extensions');
fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });
fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false,
    'window.dialogStyle': 'custom',
    'window.titleBarStyle': 'native',
    'window.commandCenter': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'chat.disableAIFeatures': true,
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': 'Default Dark Modern',
    'workbench.tips.enabled': false,
    'workbench.enableExperiments': false,
    'update.mode': 'none',
    'update.showReleaseNotes': false,
    'telemetry.telemetryLevel': 'off',
    'extensions.ignoreRecommendations': true,
    'editor.minimap.enabled': false,
    'editor.fontSize': 13,
    'workbench.list.defaultFindMode': 'filter',
    'workbench.list.defaultFindMatchType': 'contiguous',
    'bnd.cli.showCommands': true,
    // JDK 24+ caps XML entity sizes; large Eclipse p2 indexes exceed the default.
    'bnd.server.jvmArgs': ['-Djdk.xml.maxGeneralEntitySizeLimit=0', '-Djdk.xml.totalEntitySizeLimit=0'],
    'chat.commandCenter.enabled': false,
}, null, 2));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch(folder) {
    const app = await electron.launch({
        executablePath,
        args: [
            '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes',
            '--disable-telemetry', '--force-device-scale-factor=1',
            `--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`,
            `--extensionDevelopmentPath=${repoRoot}`, folder,
        ],
        env: { ...process.env, BND_SCREENSHOTS: '1' },
    });
    let page;
    for (let attempt = 0; attempt < 60 && !page; attempt++) {
        for (const candidate of app.windows()) {
            if (await candidate.locator('.monaco-workbench').count()) { page = candidate; break; }
        }
        if (!page) await sleep(500);
    }
    if (!page) throw new Error('Workbench window not found.');
    app.process().on('exit', code => console.log(`  VS Code exited with code ${code}`));
    page.on('close', () => console.log('  workbench window closed'));
    page.on('console', message => { if (message.type() === 'error') console.log(`  renderer: ${message.text().slice(0, 300)}`); });
    await app.evaluate(({ BrowserWindow }, size) => {
        for (const window of BrowserWindow.getAllWindows()) {
            if (window.isVisible()) { window.unmaximize(); window.setContentSize(size.width, size.height); window.center(); }
        }
    }, { width: WIDTH, height: HEIGHT });
    await page.waitForSelector('.monaco-workbench .part.statusbar');
    await sleep(1500);
    if (await page.locator('.part.auxiliarybar').isVisible().catch(() => false)) {
        await runCommand(page, 'View: Close Secondary Side Bar');
    }
    await sleep(500);
    return { app, page };
}

async function runCommand(page, title) {
    await page.keyboard.press('F1');
    const input = page.locator('.quick-input-widget input');
    await input.waitFor({ state: 'visible' });
    await input.fill(`>${title}`);
    await page.locator('.quick-input-list .monaco-list-row.focused').waitFor();
    await sleep(300);
    await page.keyboard.press('Enter');
}

async function openFile(page, file, root, textEditor = true) {
    // Quick Open matches on paths, so a parent folder disambiguates common names such as bnd.bnd.
    const query = root ? path.relative(root, file).split(path.sep).slice(-2).join('/') : path.basename(file);
    await page.keyboard.press('F1');
    const input = page.locator('.quick-input-widget input');
    await input.waitFor({ state: 'visible' });
    await input.fill(query);
    await page.locator(`.quick-input-list .monaco-list-row:has-text("${path.basename(file)}")`).first().waitFor();
    await sleep(300);
    await page.keyboard.press('Enter');
    if (!textEditor) { await sleep(1000); return; }
    await page.locator('.monaco-editor .view-lines').first().waitFor();
    await sleep(500);
}

async function shot(page, name, locator) {
    const file = path.join(outDir, `${name}.png`);
    if (locator) await locator.screenshot({ path: file });
    else await page.screenshot({ path: file });
    console.log(`  wrote ${path.relative(repoRoot, file)}`);
}

function wanted(name) { return !only.length || only.includes(name); }

async function waitForNoProgress(page, timeout = 300000) {
    const started = Date.now();
    await sleep(1000);
    while (Date.now() - started < timeout) {
        const busy = await page.locator('.notification-list-item-progress-container.active, .notifications-toasts .notification-list-item:has(.monaco-progress-container.active)').count();
        if (!busy) return;
        await sleep(1000);
    }
    throw new Error('Progress did not finish.');
}

async function dismissNotifications(page) {
    await page.keyboard.press('Escape');
    const clear = page.locator('.notifications-toasts .codicon-notifications-clear').first();
    while (await clear.count()) { await clear.click().catch(() => {}); await sleep(200); }
    await page.evaluate(() => document.querySelectorAll('.notifications-toasts').forEach(e => (e.style.display = 'none')));
}

async function focusBndContainer(page) {
    await runCommand(page, 'View: Show bnd');
    await sleep(800);
}

async function collapseExplorerPane(page) {
    const header = page.locator('.pane-header:has-text("Explorer")').first();
    if ((await header.getAttribute('aria-expanded')) === 'true') await header.click();
    await sleep(400);
}

async function wizardScenario() {
    const folder = path.join('/tmp', 'bnd-demo', 'com.example.rcp');
    const wizardShots = wanted('wizard-create-template') || wanted('wizard-welcome') || wanted('wizard-add-fragments');
    if (!wizardShots && !fs.existsSync(path.join(folder, 'cnf', 'build.bnd'))) {
        // Result/P2 images only: seed the folder from the stored fixture instead of running the wizards.
        const fixture = path.join(repoRoot, 'examples', 'com.example.rcp');
        if (fs.existsSync(path.join(fixture, 'cnf', 'build.bnd'))) {
            fs.mkdirSync(path.dirname(folder), { recursive: true });
            fs.cpSync(fixture, folder, { recursive: true });
            console.log(`  seeded ${folder} from examples/com.example.rcp`);
        }
    }
    const reuse = !wanted('wizard-create-template') && !wanted('wizard-welcome') && fs.existsSync(path.join(folder, 'cnf', 'build.bnd'));
    if (!reuse) {
        fs.rmSync(folder, { recursive: true, force: true });
        fs.mkdirSync(folder, { recursive: true });
    }
    const { app, page } = await launch(folder);
    try {
        await focusBndContainer(page);
        if (!reuse) {
            await page.locator('.welcome-view-content').first().waitFor();
            await sleep(1000);
        }
        if (wanted('wizard-welcome')) await shot(page, 'wizard-welcome');

        if (wanted('wizard-create-template')) {
            await runCommand(page, 'bnd: Create New Workspace From Template');
            await page.locator('.quick-input-title:has-text("Create New Workspace From Template")').waitFor({ timeout: 180000 });
            await page.locator('.quick-input-list .monaco-list-row').first().waitFor();
            await sleep(800);
            await shot(page, 'wizard-create-template');
            await page.keyboard.press('Enter');
            const dialog = page.locator('.monaco-dialog-box');
            await dialog.waitFor();
            await sleep(500);
            await shot(page, 'wizard-create-confirm');
            await dialog.locator('.monaco-button:has-text("Create Workspace")').click();
            await waitForNoProgress(page);
            for (let i = 0; i < 120 && !fs.existsSync(path.join(folder, 'cnf', 'build.bnd')); i++) await sleep(1000);
            await sleep(1500);
            await dismissNotifications(page);
            await openFile(page, 'build.bnd');
            await focusBndContainer(page);
            await page.locator('.pane-header:has-text("Explorer") + .pane-body .monaco-list-row:has-text("cnf")').first().click();
            await sleep(800);
            await shot(page, 'wizard-created');
        }

        if (wanted('wizard-add-fragments')) {
            await runCommand(page, 'bnd: Add Fragment to (New) Workspace');
            await page.locator('.quick-input-title:has-text("Add Fragment to (New) Workspace")').waitFor({ timeout: 180000 });
            await page.locator('.quick-input-list .monaco-list-row').first().waitFor();
            await page.locator('.quick-input-widget input').fill('Eclipse RCP');
            await sleep(500);
            for (const name of ['Eclipse RCP E4 Application', 'Eclipse RCP SWTBot Tests']) {
                const row = page.locator(`.quick-input-list .monaco-list-row:has-text("${name}")`).first();
                await row.waitFor();
                const checkbox = row.locator('input[type="checkbox"], .quick-input-list-checkbox');
                if (await checkbox.count()) await checkbox.first().click(); else await row.click();
                await sleep(300);
            }
            await page.locator('.quick-input-list .monaco-list-row:has-text("Eclipse RCP E4 Application")').first().hover();
            await sleep(500);
            await shot(page, 'wizard-add-fragments');
            await page.keyboard.press('Enter');
            const dialog = page.locator('.monaco-dialog-box');
            await dialog.waitFor();
            await sleep(500);
            await shot(page, 'wizard-add-fragments-confirm');
            await dialog.locator('.monaco-button:has-text("Add Fragments")').click();
            await waitForNoProgress(page, 900000);
            await sleep(2000);
            await dismissNotifications(page);
        }

        if (wanted('wizard-add-fragments') || wanted('wizard-add-fragments-result') || wanted('repositories-p2')) {
            fixUpstreamSwtbotFragment(folder);
            const entries = fs.readdirSync(folder).filter(name => !name.startsWith('.'));
            console.log(`  fragment result: ${entries.join(', ')}`);
            const bndrun = findFiles(folder, name => name.endsWith('_shared.bndrun'))[0] ?? findFiles(folder, name => name.endsWith('.bndrun'))[0];
            if (bndrun) await openFile(page, bndrun);
            await focusBndContainer(page);
            await runCommand(page, 'bnd Explorer: Focus on Explorer View');
            await sleep(500);
            const list = page.locator('.pane-header:has-text("Explorer") + .pane-body');
            for (const name of entries.filter(name => name.includes('app') || name.includes('ui'))) {
                const row = list.locator(`.monaco-list-row:has-text("${name}")`).first();
                if (await row.count()) { await row.locator('.monaco-tl-twistie').click().catch(() => {}); await sleep(300); }
            }
            await page.locator('.monaco-editor .codelens-decoration').first().waitFor({ timeout: 120000 }).catch(() => {});
            await runCommand(page, 'bnd: Refresh Repositories');
            const repositories = page.locator('.pane-header:has-text("Repositories") + .pane-body');
            await repositories.locator('.monaco-list-row:has-text("Eclipse Platform")').first().waitFor({ timeout: 900000 }).catch(() => {});
            await sleep(1000);
            await dismissNotifications(page);
            if (wanted('wizard-add-fragments') || wanted('wizard-add-fragments-result')) await shot(page, 'wizard-add-fragments-result');
            if (wanted('repositories-p2')) {
                await runCommand(page, 'View: Close All Editors');
                await collapseExplorerPane(page);
                for (let i = 0; i < 6; i++) await runCommand(page, 'View: Increase Current View Size');
                await runCommand(page, 'bnd: Filter Repositories');
                const input = page.locator('.quick-input-widget input');
                await input.waitFor();
                await input.fill('org.eclipse.e4.*');
                await page.keyboard.press('Enter');
                await sleep(1000);
                const platform = repositories.locator('.monaco-list-row:has-text("Eclipse Platform")').first();
                await platform.locator('.monaco-tl-twistie').click();
                await repositories.locator('.monaco-list-row[aria-level="3"]').first().waitFor({ timeout: 600000 });
                await sleep(1000);
                // Monaco lists are virtualized: scroll with the wheel until the feature row (extensions icon) is rendered.
                await page.keyboard.press('Escape');
                const feature = repositories.locator('.monaco-list-row:has(.codicon-extensions):has-text("org.eclipse.e4.rcp")').first();
                const box = await repositories.boundingBox();
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                for (let i = 0; i < 400 && !(await feature.isVisible().catch(() => false)); i++) {
                    await page.mouse.wheel(0, 300);
                    await sleep(120);
                }
                await feature.waitFor({ timeout: 30000 });
                await page.keyboard.press('Escape');
                await sleep(500);
                await feature.locator('.monaco-tl-twistie').click();
                const included = repositories.locator('.monaco-list-row:has-text("Included Bundles")').first();
                await included.waitFor({ timeout: 60000 });
                await included.locator('.monaco-tl-twistie').click();
                await sleep(1500);
                // Scroll so the feature row sits near the top and its children fill the view.
                for (let i = 0; i < 40; i++) {
                    const featureBox = await feature.boundingBox().catch(() => null);
                    if (!featureBox || featureBox.y - box.y < 140) break;
                    await page.mouse.wheel(0, Math.min(300, featureBox.y - box.y - 120));
                    await sleep(150);
                }
                await sleep(500);
                await shot(page, 'repositories-p2', page.locator('.part.sidebar'));
            }
        }
    } finally {
        await app.close();
    }
}

// The upstream swtbot-tests fragment (as of 2026-10) writes `url.` and `cache.` with a stray dot,
// so P2Repository reports "you must set the url parameter". Repair the keys for the screenshots.
function fixUpstreamSwtbotFragment(folder) {
    for (const file of findFiles(path.join(folder, 'cnf'), name => /^swtbot_.*\.bnd$/.test(name))) {
        const text = fs.readFileSync(file, 'utf8');
        const fixed = text.replace(/^(\s*)url\.(\s*=)/m, '$1url$2').replace(/^(\s*)cache\.(\s*=)/m, '$1cache$2');
        if (fixed !== text) { fs.writeFileSync(file, fixed); console.log(`  repaired ${path.relative(folder, file)}`); }
    }
}

function findFiles(root, predicate) {
    const result = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'generated' || entry.name === 'bin') continue;
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) result.push(...findFiles(full, predicate));
        else if (predicate(entry.name)) result.push(full);
    }
    return result;
}

async function typeAtEnd(page, text) {
    await page.keyboard.press('Meta+End');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(text, { delay: 30 });
}

async function webviewFrame(page, selector) {
    // Webviews nest an outer iframe and an #active-frame; several may exist, so find the one containing `selector`.
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        for (const frame of page.frames()) {
            if (await frame.locator(selector).count().catch(() => 0)) return frame;
        }
        await sleep(500);
    }
    throw new Error(`No webview frame with ${selector}`);
}

async function demoScenario() {
    if (!demoWorkspace) { console.log('BND_DEMO_WORKSPACE not set; skipping editor screenshots.'); return; }
    const names = ['completions', 'hover', 'effective', 'repositories', 'repositories-search', 'jar-viewer', 'resolution', 'cli-reference', 'launch-codelens', 'quickfix'];
    if (!names.some(wanted)) return;
    const { app, page } = await launch(demoWorkspace);
    const editor = page.locator('.monaco-editor').first();
    try {
        // Keep edits in a scratch project inside the demo workspace that is removed afterwards.
        const scratchProject = path.join(demoWorkspace, 'docs.screenshots.tmp');
        fs.mkdirSync(path.join(scratchProject, 'src', 'docs', 'screenshots', 'api'), { recursive: true });
        fs.writeFileSync(path.join(scratchProject, 'src', 'docs', 'screenshots', 'api', 'Greeter.java'),
            'package docs.screenshots.api;\n\npublic interface Greeter {\n\tString greet(String name);\n}\n');
        const scratchBnd = path.join(scratchProject, 'bnd.bnd');
        fs.writeFileSync(scratchBnd, [
            'Bundle-Description: Screenshot sample for the VS Code bnd extension',
            '-propertyconflicts: warning',
            '',
            '-buildpath: \\',
            '    osgi.annotation,\\',
            '    osgi.core',
            '',
            'Export-Package: docs.screenshots.api;version=${Bundle-Version}',
            '-dsannotations: *',
            '-runvm: -Xmx512m',
            '',
        ].join('\n'));
        const revert = async () => {
            await runCommand(page, 'File: Revert File');
            await sleep(300);
            await runCommand(page, 'View: Close All Editors');
        };
        if (process.env.BND_SHOT_DEBUG) {
            page.on('console', message => console.log(`  console: ${message.text().slice(0, 300)}`));
        }
        try {
            await focusBndContainer(page);
            await page.locator('.pane-header:has-text("Repositories") + .pane-body .monaco-list-row').first().waitFor({ timeout: 600000 });
            await sleep(1000);

            if (wanted('completions')) {
                await openFile(page, scratchBnd, demoWorkspace);
                await editor.click();
                await typeAtEnd(page, '-run');
                await page.keyboard.press('Control+Space');
                await page.locator('.suggest-widget.visible').waitFor();
                await page.locator('.suggest-widget .monaco-list-row.focused').waitFor();
                await sleep(1200);
                await shot(page, 'completions');
                await page.keyboard.press('Escape');
                await revert();
            }

            if (wanted('hover')) {
                await openFile(page, scratchBnd, demoWorkspace);
                const token = editor.locator('.view-line:has-text("-buildpath") span:has-text("-buildpath")').first();
                await token.hover();
                await page.locator('.monaco-hover:visible').first().waitFor({ timeout: 20000 });
                await sleep(800);
                await shot(page, 'hover');
                await page.mouse.move(10, 10);
                await revert();
            }

            if (wanted('quickfix')) {
                await openFile(page, scratchBnd, demoWorkspace);
                await editor.click();
                await typeAtEnd(page, '-runvm: -Dscreenshots=true');
                const squiggle = editor.locator('.squiggly-warning, .squiggly-error').first();
                await squiggle.waitFor({ timeout: 90000 });
                await page.keyboard.press('Home');
                await page.keyboard.press('Meta+.');
                await page.locator('.action-widget:visible').first().waitFor({ timeout: 20000 });
                await sleep(800);
                await shot(page, 'quickfix');
                await page.keyboard.press('Escape');
                await revert();
            }

            if (wanted('effective')) {
                await openFile(page, path.join(demoWorkspace, 'biz.aQute.bndlib', 'bnd.bnd'), demoWorkspace);
                await runCommand(page, 'bnd: Open Effective to Side');
                const webview = await webviewFrame(page, '#rows tr');
                await runCommand(page, 'View: Close Editors in Other Groups');
                await webview.locator('#filter').fill('path');
                await sleep(800);
                await webview.locator('#rows tr:has-text("-buildpath") summary').first().click();
                await sleep(800);
                await sleep(1200);
                await shot(page, 'effective');
                await runCommand(page, 'View: Close All Editors');
            }

            if (wanted('repositories') || wanted('resolution')) {
                await runCommand(page, 'View: Close All Editors');
                await focusBndContainer(page);
                const repositories = page.locator('.pane-header:has-text("Repositories") + .pane-body');
                await collapseExplorerPane(page);
                for (let i = 0; i < 4; i++) await runCommand(page, 'View: Increase Current View Size');
                await runCommand(page, 'bnd: Filter Repositories');
                const input = page.locator('.quick-input-widget input');
                await input.waitFor();
                await input.fill('org.apache.felix.gogo*');
                await page.keyboard.press('Enter');
                await sleep(1000);
                const central = repositories.locator('.monaco-list-row:has-text("Maven Central")').first();
                await central.scrollIntoViewIfNeeded();
                await central.locator('.monaco-tl-twistie').click();
                const bundle = repositories.locator('.monaco-list-row:has-text("org.apache.felix.gogo.shell")').first();
                await bundle.waitFor({ timeout: 120000 });
                await bundle.locator('.monaco-tl-twistie').click();
                await repositories.locator('.monaco-list-row:has(.codicon-tag)').first().waitFor({ timeout: 60000 });
                await sleep(800);
                if (wanted('repositories')) await shot(page, 'repositories', page.locator('.part.sidebar'));
                if (wanted('resolution')) {
                    await runCommand(page, 'Resolution: Focus on Resolution View');
                    await sleep(500);
                    await bundle.click({ position: { x: 60, y: 11 } });
                    await sleep(300);
                    const runtime = repositories.locator('.monaco-list-row:has-text("org.apache.felix.gogo.runtime")').first();
                    await runtime.click({ modifiers: ['Meta'], position: { x: 60, y: 11 } });
                    const panel = await webviewFrame(page, '#requirements');
                    await panel.locator('#requirements .row, #requirements tr, #requirements li, #requirements > *').first().waitFor({ timeout: 120000 });
                    await sleep(2000);
                    await runCommand(page, 'View: Close All Editors');
                    await runCommand(page, 'View: Toggle Maximized Panel');
                    await sleep(800);
                    await shot(page, 'resolution');
                    await runCommand(page, 'View: Toggle Maximized Panel');
                    await runCommand(page, 'View: Close Panel');
                }
                await runCommand(page, 'bnd: Clear Repository Filter').catch(() => {});
            }

            if (wanted('repositories-search')) {
                await focusBndContainer(page);
                await collapseExplorerPane(page);
                await runCommand(page, 'bnd: Advanced Search');
                await page.locator('.quick-input-widget').waitFor();
                await page.locator('.quick-input-list .monaco-list-row:has-text("Package")').first().click();
                await page.locator('.quick-input-widget input').fill('org.osgi.service.component');
                await page.keyboard.press('Enter');
                await sleep(400);
                await page.locator('.quick-input-widget input').fill('[1.5,2)');
                await page.keyboard.press('Enter');
                const repositories = page.locator('.pane-header:has-text("Repositories") + .pane-body');
                await repositories.locator('.monaco-list-row:has(.codicon-star-full)').first().waitFor({ timeout: 180000 });
                await sleep(1500);
                await shot(page, 'repositories-search', page.locator('.part.sidebar'));
                await runCommand(page, 'bnd: Clear Repository Search').catch(() => {});
            }

            if (wanted('jar-viewer')) {
                await runCommand(page, 'View: Close All Editors');
                // Open the project's built JAR through the Workspace repository (activation opens the JAR Viewer).
                await focusBndContainer(page);
                const repositories = page.locator('.pane-header:has-text("Repositories") + .pane-body');
                await collapseExplorerPane(page);
                await runCommand(page, 'bnd: Filter Repositories');
                await page.locator('.quick-input-widget input').waitFor();
                await page.locator('.quick-input-widget input').fill('biz.aQute.bndlib');
                await page.keyboard.press('Enter');
                await sleep(1000);
                const workspace = repositories.locator('.monaco-list-row:has-text("Workspace")').first();
                if ((await workspace.getAttribute('aria-expanded')) !== 'true') await workspace.locator('.monaco-tl-twistie').click();
                const project = repositories.locator('.monaco-list-row[aria-level="3"]:has-text("biz.aQute.bndlib")').first();
                await project.waitFor({ timeout: 60000 });
                if ((await project.getAttribute('aria-expanded')) !== 'true') await project.locator('.monaco-tl-twistie').click();
                const bundle = repositories.locator('.monaco-list-row[aria-level="4"]:has-text("biz.aQute.bndlib")').first();
                await bundle.waitFor({ timeout: 60000 });
                await bundle.click();
                const viewer = await webviewFrame(page, '#tree li');
                await runCommand(page, 'bnd: Clear Repository Filter').catch(() => {});
                await sleep(1500);
                await shot(page, 'jar-viewer');
                await viewer.locator('#tab-print').click();
                await viewer.locator('#page-print pre, #page-print').first().waitFor({ timeout: 60000 });
                await sleep(2000);
                await shot(page, 'jar-viewer-print');
                await runCommand(page, 'View: Close All Editors');
            }

            if (wanted('launch-codelens')) {
                await runCommand(page, 'View: Close All Editors');
                await openFile(page, path.join(demoWorkspace, 'biz.aQute.bnd.runtime', 'run.bndrun'), demoWorkspace);
                await page.locator('.monaco-editor .codelens-decoration:has-text("Run OSGi")').first().waitFor({ timeout: 120000 });
                await sleep(800);
                await shot(page, 'launch-codelens');
            }

            if (wanted('cli-reference')) {
                await runCommand(page, 'View: Close All Editors');
                await runCommand(page, 'bnd-cli: Show CLI Reference');
                const webview = await webviewFrame(page, '#search');
                await webview.locator('#search').fill('wrap');
                await sleep(500);
                await webview.locator('#cmd-wrap summary').first().click().catch(() => {});
                await sleep(800);
                await shot(page, 'cli-reference');
            }
        } finally {
            fs.rmSync(scratchProject, { recursive: true, force: true });
        }
    } finally {
        await app.close();
    }
}

async function main() {
    console.log(`Output: ${outDir}`);
    const wizardNames = ['wizard-welcome', 'wizard-create-template', 'wizard-add-fragments', 'wizard-add-fragments-result', 'repositories-p2'];
    if (wizardNames.some(wanted)) await wizardScenario();
    await demoScenario();
    if (!keep) fs.rmSync(scratch, { recursive: true, force: true });
    else console.log(`Kept ${scratch}`);
}

main().catch(error => { console.error(error); process.exit(1); });
