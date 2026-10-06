(() => {
    'use strict';
    const vscode = acquireVsCodeApi();
    const state = Object.assign({ tab: 'tree', expanded: [], showAs: 'auto', charset: 'utf-8', limit: true }, vscode.getState() || {});
    const expanded = new Set(state.expanded);
    const $ = id => document.getElementById(id);
    const tree = $('tree');
    const content = $('content');
    const error = $('error');
    const charset = $('charset');
    const limit = $('limit');
    let printLoaded = false;
    let items = [];

    function persist() {
        state.expanded = [...expanded];
        vscode.setState(state);
    }

    function showTab(tab) {
        state.tab = tab;
        persist();
        for (const name of ['tree', 'print']) {
            const selected = name === tab;
            $(`tab-${name}`).setAttribute('aria-selected', String(selected));
            $(`tab-${name}`).tabIndex = selected ? 0 : -1;
            $(`page-${name}`).hidden = !selected;
        }
        if (tab === 'print' && !printLoaded) requestPrint();
    }

    function requestPrint() {
        printLoaded = true;
        $('print-status').textContent = 'Printing JAR file...';
        $('page-print').setAttribute('aria-busy', 'true');
        vscode.postMessage({ type: 'print' });
    }

    function buildTree(entries) {
        const root = { children: new Map() };
        for (const entry of entries) {
            const parts = entry.name.split('/');
            let node = root;
            parts.forEach((part, index) => {
                const name = parts.slice(0, index + 1).join('/');
                if (!node.children.has(part)) node.children.set(part, { name, label: part, children: new Map(), directory: true });
                node = node.children.get(part);
                if (index === parts.length - 1 && !entry.directory) node.directory = false;
            });
        }
        return root;
    }

    function sorted(node) {
        return [...node.children.values()].sort((a, b) => Number(b.directory) - Number(a.directory)
            || a.label.localeCompare(b.label, undefined, { numeric: true }));
    }

    let root;
    function render() {
        const fragment = document.createDocumentFragment();
        items = [];
        const add = (node, depth, parent) => {
            for (const child of sorted(node)) {
                const li = document.createElement('li');
                li.setAttribute('role', 'treeitem');
                li.setAttribute('aria-level', String(depth + 1));
                li.setAttribute('aria-selected', String(child.name === state.selection));
                li.style.paddingLeft = `${depth * 14 + 4}px`;
                li.title = child.name;
                const open = expanded.has(child.name);
                if (child.directory) li.setAttribute('aria-expanded', String(open));
                const twistie = document.createElement('i');
                twistie.className = `codicon ${child.directory ? (open ? 'codicon-chevron-down' : 'codicon-chevron-right') : 'codicon-blank'}`;
                twistie.setAttribute('aria-hidden', 'true');
                const icon = document.createElement('i');
                icon.className = `codicon ${child.directory ? (open ? 'codicon-folder-opened' : 'codicon-folder') : 'codicon-file'}`;
                icon.setAttribute('aria-hidden', 'true');
                const label = document.createElement('span');
                label.textContent = child.label;
                li.append(twistie, icon, label);
                li.addEventListener('click', () => {
                    if (child.directory) toggle(child.name);
                    select(child);
                });
                li.addEventListener('dblclick', () => { if (!child.directory) vscode.postMessage({ type: 'open', name: child.name }); });
                fragment.append(li);
                items.push({ node: child, element: li, depth, parent });
                if (child.directory && open) add(child, depth + 1, child);
            }
        };
        add(root, 0, undefined);
        tree.replaceChildren(fragment);
        const current = items.find(item => item.node.name === state.selection);
        if (current) current.element.scrollIntoView({ block: 'nearest' });
    }

    function toggle(name, value) {
        if (value ?? !expanded.has(name)) expanded.add(name); else expanded.delete(name);
        persist();
        render();
    }

    function select(node) {
        state.selection = node.name;
        persist();
        render();
        $('entry-name').textContent = node.name;
        $('open').disabled = node.directory;
        loadEntry();
    }

    function loadEntry() {
        if (!state.selection) return;
        content.setAttribute('aria-busy', 'true');
        vscode.postMessage({ type: 'select', name: state.selection, showAs: state.showAs, charset: state.charset, limit: state.limit });
    }

    function reveal(name) {
        const parts = name.split('/');
        for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
    }

    tree.addEventListener('keydown', event => {
        const index = items.findIndex(item => item.node.name === state.selection);
        const current = items[index];
        switch (event.key) {
            case 'ArrowDown': if (items[index + 1]) select(items[index + 1].node); break;
            case 'ArrowUp': if (index > 0) select(items[index - 1].node); break;
            case 'ArrowRight': if (current?.node.directory) toggle(current.node.name, true); break;
            case 'ArrowLeft':
                if (current?.node.directory && expanded.has(current.node.name)) toggle(current.node.name, false);
                else if (current?.parent) select(current.parent);
                break;
            case 'Enter':
                if (!current) break;
                if (current.node.directory) toggle(current.node.name);
                else vscode.postMessage({ type: 'open', name: current.node.name });
                break;
            default: return;
        }
        event.preventDefault();
    });

    for (const radio of document.querySelectorAll('input[name=show]')) {
        radio.checked = radio.value === state.showAs;
        radio.addEventListener('change', () => {
            state.showAs = radio.value;
            charset.disabled = state.showAs !== 'text';
            persist();
            loadEntry();
        });
    }
    charset.disabled = state.showAs !== 'text';
    charset.addEventListener('change', () => { state.charset = charset.value; persist(); loadEntry(); });
    limit.checked = state.limit;
    limit.addEventListener('change', () => { state.limit = limit.checked; persist(); loadEntry(); });
    $('open').addEventListener('click', () => vscode.postMessage({ type: 'open', name: state.selection }));
    $('print-refresh').addEventListener('click', requestPrint);
    for (const name of ['tree', 'print']) {
        $(`tab-${name}`).addEventListener('click', () => showTab(name));
        $(`tab-${name}`).addEventListener('keydown', event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                const other = name === 'tree' ? 'print' : 'tree';
                showTab(other);
                $(`tab-${other}`).focus();
            }
        });
    }

    window.addEventListener('message', event => {
        const data = event.data;
        switch (data.type) {
            case 'tree':
                error.hidden = true;
                root = buildTree(data.entries);
                charset.replaceChildren(...data.charsets.map(label => new Option(label, label, false, label === state.charset)));
                if (!state.selection || !data.entries.some(entry => entry.name === state.selection
                    || entry.name.startsWith(`${state.selection}/`))) {
                    state.selection = data.selection;
                }
                if (state.selection) {
                    reveal(state.selection);
                    const node = state.selection.split('/').reduce((node, part) => node && node.children.get(part), root);
                    if (node) select(node); else render();
                } else {
                    render();
                }
                break;
            case 'entry':
                if (data.name !== state.selection) break;
                content.textContent = data.content;
                content.classList.toggle('hex', data.mode === 'hex');
                content.setAttribute('aria-busy', 'false');
                $('size').textContent = data.size;
                $('modified').textContent = data.modified;
                break;
            case 'print':
                $('print').textContent = data.text;
                $('print-status').textContent = '';
                $('page-print').setAttribute('aria-busy', 'false');
                break;
            case 'printError':
                $('print').textContent = '';
                $('print-status').textContent = data.message;
                $('page-print').setAttribute('aria-busy', 'false');
                printLoaded = false;
                break;
            case 'changed':
                printLoaded = false;
                vscode.postMessage({ type: 'ready' });
                if (state.tab === 'print') requestPrint();
                break;
            case 'error':
                error.textContent = data.message;
                error.hidden = false;
                break;
        }
    });
    showTab(state.tab);
    vscode.postMessage({ type: 'ready' });
})();
