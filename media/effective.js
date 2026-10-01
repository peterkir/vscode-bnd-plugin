(() => {
    'use strict';
    const vscode = acquireVsCodeApi();
    const saved = vscode.getState() || {};
    const filter = document.getElementById('filter');
    const expanded = document.getElementById('expanded');
    const merged = document.getElementById('merged');
    const rows = document.getElementById('rows');
    const count = document.getElementById('count');
    const notice = document.getElementById('notice');
    const error = document.getElementById('error');
    const main = document.querySelector('main');
    let result;
    let dirtyDependencies = false;
    const widths = Array.isArray(saved.widths) ? saved.widths : [];
    filter.value = typeof saved.filter === 'string' ? saved.filter : '';
    expanded.checked = saved.expanded !== false;
    merged.checked = expanded.checked && saved.merged !== false;
    merged.disabled = !expanded.checked;

    function persist() {
        vscode.setState({ filter: filter.value, expanded: expanded.checked, merged: merged.checked,
            widths, scroll: main.scrollTop });
    }
    function options(type) {
        vscode.postMessage({ type, expanded: expanded.checked, merged: merged.checked });
    }
    function showNotice() {
        const messages = result?.diagnostics ? [...result.diagnostics] : [];
        if (dirtyDependencies) messages.unshift('Included files have unsaved edits; using their saved contents.');
        notice.textContent = messages.join('\n');
        notice.hidden = messages.length === 0;
    }
    function render() {
        if (!result) return;
        const search = filter.value.toLowerCase();
        const fragment = document.createDocumentFragment();
        let visible = 0;
        result.rows.forEach((row, rowIndex) => {
            const searchable = [row.key, row.value, ...row.provenances.map(origin => origin.label), ...row.errors].join('\n');
            if (!searchable.toLowerCase().includes(search)) return;
            visible++;
            const element = document.createElement('tr');
            const key = document.createElement('td');
            key.textContent = row.key;
            const value = document.createElement('td');
            const detail = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = row.value || '(empty)';
            summary.title = row.formattedValue || row.value;
            const full = document.createElement('pre');
            full.textContent = row.formattedValue || row.value;
            detail.append(summary, full);
            value.append(detail);
            const origins = document.createElement('td');
            row.provenances.forEach((origin, originIndex) => {
                const link = document.createElement(origin.uri ? 'button' : 'span');
                link.className = origin.uri ? 'origin' : 'logical';
                link.textContent = origin.label.replace(/\\/g, '/').split('/').pop() || origin.label;
                link.title = origin.label;
                if (origin.uri) {
                    link.addEventListener('click', () => vscode.postMessage({ type: 'origin', row: rowIndex, origin: originIndex }));
                }
                origins.append(link);
            });
            const errors = document.createElement('td');
            errors.className = 'row-errors';
            errors.textContent = row.errors.join('\n');
            element.append(key, value, origins, errors);
            fragment.append(element);
        });
        rows.replaceChildren(fragment);
        count.textContent = `${visible} of ${result.rows.length} properties`;
        document.getElementById('empty').hidden = visible !== 0;
    }
    filter.addEventListener('input', () => { persist(); render(); });
    expanded.addEventListener('change', () => {
        merged.disabled = !expanded.checked;
        if (!expanded.checked) merged.checked = false;
        persist();
        options('options');
    });
    merged.addEventListener('change', () => { persist(); options('options'); });
    main.addEventListener('scroll', persist);
    ['refresh', 'copy', 'source', 'effectiveSource'].forEach(type => {
        document.getElementById(type).addEventListener('click', () => vscode.postMessage({ type }));
    });
    document.querySelectorAll('th').forEach((heading, index) => {
        const column = document.querySelectorAll('col')[index];
        const resize = document.createElement('span');
        resize.className = 'resize';
        resize.tabIndex = 0;
        resize.setAttribute('role', 'separator');
        resize.setAttribute('aria-orientation', 'vertical');
        resize.setAttribute('aria-label', `Resize ${heading.textContent} column`);
        const setWidth = width => {
            widths[index] = Math.max(80, Math.min(1800, width));
            column.style.width = `${widths[index]}px`;
            resize.setAttribute('aria-valuenow', String(Math.round(widths[index])));
            persist();
        };
        resize.setAttribute('aria-valuemin', '80');
        resize.setAttribute('aria-valuemax', '1800');
        resize.setAttribute('aria-valuenow', String(Math.round(heading.getBoundingClientRect().width)));
        if (typeof widths[index] === 'number') column.style.width = `${widths[index]}px`;
        resize.addEventListener('keydown', event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setWidth(heading.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 20 : -20));
            }
        });
        resize.addEventListener('pointerdown', event => {
            const start = event.clientX;
            const width = heading.getBoundingClientRect().width;
            resize.setPointerCapture(event.pointerId);
            const move = movement => setWidth(width + movement.clientX - start);
            const stop = () => resize.removeEventListener('pointermove', move);
            resize.addEventListener('pointermove', move);
            resize.addEventListener('pointerup', stop, { once: true });
            resize.addEventListener('lostpointercapture', stop, { once: true });
        });
        heading.append(resize);
    });
    window.addEventListener('message', event => {
        const data = event.data;
        switch (data.type) {
            case 'loading':
                count.textContent = 'Updating properties...';
                main.setAttribute('aria-busy', 'true');
                document.getElementById('copy').disabled = true;
                rows.querySelectorAll('button').forEach(button => { button.disabled = true; });
                error.hidden = true;
                break;
            case 'result':
                result = data.result;
                expanded.checked = result.expanded;
                merged.checked = result.merged;
                merged.disabled = !result.expanded;
                main.setAttribute('aria-busy', 'false');
                document.getElementById('copy').disabled = false;
                error.hidden = true;
                render();
                showNotice();
                if (typeof saved.scroll === 'number') { main.scrollTop = saved.scroll; delete saved.scroll; }
                break;
            case 'status':
                dirtyDependencies = data.dirtyDependencies;
                document.getElementById('snapshot').textContent = data.dirty ? 'Current file: unsaved changes' : 'Current file: saved';
                showNotice();
                break;
            case 'error':
                error.textContent = data.message;
                error.hidden = false;
                main.setAttribute('aria-busy', 'false');
                count.textContent = 'Effective properties unavailable';
                result = undefined;
                rows.replaceChildren();
                document.getElementById('copy').disabled = true;
                document.getElementById('empty').hidden = true;
                break;
        }
    });
    options('ready');
})();