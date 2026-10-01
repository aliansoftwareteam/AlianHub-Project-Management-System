const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const src = (...parts) => parts.map(encodeURIComponent).join('/');

const unique = (items) => [...new Set(items)];

const STYLE = `
:root { color-scheme: light dark; --bg: #f4f5f7; --card: #fff; --ink: #16181d; --dim: #646b78; --line: #dcdfe5; --accent: #3d5afe; --hot: #ff0066; }
@media (prefers-color-scheme: dark) { :root { --bg: #111318; --card: #1b1e25; --ink: #eceef2; --dim: #9aa1ad; --line: #2c313b; --accent: #8c9eff; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line); padding: 14px 20px; }
h1 { margin: 0 0 4px; font-size: 18px; }
.meta { color: var(--dim); font-size: 12px; }
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.bar input[type=search] { padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: inherit; min-width: 200px; }
.chip { padding: 5px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); color: inherit; cursor: pointer; font: inherit; }
.chip[aria-pressed=true] { background: var(--accent); border-color: var(--accent); color: #fff; }
.sep { width: 1px; height: 20px; background: var(--line); }
main { padding: 20px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.card { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.card[hidden], .row[hidden] { display: none; }
.shot { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.shot img { display: block; width: 100%; height: auto; }
figcaption { display: flex; justify-content: space-between; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--line); }
figcaption span { color: var(--dim); font-size: 12px; white-space: nowrap; }
.note { margin: 0; padding: 0 12px 8px; color: var(--hot); font-size: 12px; overflow-wrap: anywhere; }
.row { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin-bottom: 16px; }
.row h2 { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; margin: 0; padding: 10px 14px; font-size: 14px; border-bottom: 1px solid var(--line); }
.row h2 span { color: var(--dim); font-weight: 400; font-size: 12px; }
.row h2 .pct { margin-left: auto; color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.row h2 .pct.changed { color: var(--hot); }
.trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line); }
.trio > div { background: var(--card); }
.trio .label { padding: 4px 10px; color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.trio .none { padding: 30px 10px; color: var(--dim); text-align: center; }
.failures { margin: 0 0 20px; padding: 12px 16px 12px 32px; background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--hot); border-radius: 8px; }
.empty { color: var(--dim); }
#lightbox { position: fixed; inset: 0; z-index: 10; display: none; flex-direction: column; background: rgba(10, 11, 14, .94); color: #fff; }
#lightbox.open { display: flex; }
#lightbox .top { display: flex; justify-content: space-between; gap: 12px; padding: 10px 16px; font-size: 13px; }
#lightbox .top button { background: none; border: 1px solid #555; border-radius: 6px; color: inherit; padding: 2px 10px; cursor: pointer; font: inherit; }
#lightbox .stage { flex: 1; overflow: auto; padding: 0 16px 16px; text-align: center; cursor: zoom-out; }
#lightbox img { max-width: none; }
#lightbox.fit img { max-width: 100%; }
`;

const SCRIPT = `
(function () {
    var state = { theme: null, size: null, text: '', changedOnly: false };
    var items = [].slice.call(document.querySelectorAll('[data-item]'));
    var box = document.getElementById('lightbox');
    var boxImg = box.querySelector('img');
    var boxLabel = box.querySelector('.name');
    var current = null;

    function apply() {
        items.forEach(function (item) {
            var show = (!state.theme || item.dataset.theme === state.theme)
                && (!state.size || item.dataset.size === state.size)
                && (!state.text || item.dataset.screen.indexOf(state.text) !== -1)
                && (!state.changedOnly || item.dataset.changed === 'true');
            item.hidden = !show;
        });
        var shown = items.filter(function (item) { return !item.hidden; }).length;
        var count = document.getElementById('count');
        if (count) count.textContent = shown + ' of ' + items.length;
    }

    [].slice.call(document.querySelectorAll('[data-filter]')).forEach(function (chip) {
        chip.addEventListener('click', function () {
            var key = chip.dataset.filter;
            var next = chip.getAttribute('aria-pressed') === 'true' ? null : chip.dataset.value;
            [].slice.call(document.querySelectorAll('[data-filter="' + key + '"]')).forEach(function (other) { other.setAttribute('aria-pressed', 'false'); });
            if (next) chip.setAttribute('aria-pressed', 'true');
            state[key] = key === 'changedOnly' ? Boolean(next) : next;
            apply();
        });
    });

    var search = document.getElementById('search');
    if (search) search.addEventListener('input', function () { state.text = search.value.trim().toLowerCase(); apply(); });

    function visibleShots() {
        return [].slice.call(document.querySelectorAll('.shot')).filter(function (shot) { return !shot.closest('[data-item]').hidden; });
    }
    function open(shot) {
        current = shot;
        boxImg.src = shot.dataset.full;
        boxLabel.textContent = shot.dataset.label;
        box.classList.add('open');
    }
    function close() { box.classList.remove('open'); boxImg.removeAttribute('src'); current = null; }
    function step(by) {
        var shots = visibleShots();
        var at = shots.indexOf(current);
        if (at === -1 || !shots.length) return;
        open(shots[(at + by + shots.length) % shots.length]);
    }

    document.addEventListener('click', function (event) {
        var shot = event.target.closest('.shot');
        if (shot) open(shot);
    });
    box.querySelector('.stage').addEventListener('click', close);
    box.querySelector('.close').addEventListener('click', close);
    box.querySelector('.fit').addEventListener('click', function () { box.classList.toggle('fit'); });
    box.querySelector('.prev').addEventListener('click', function () { step(-1); });
    box.querySelector('.next').addEventListener('click', function () { step(1); });
    document.addEventListener('keydown', function (event) {
        if (!current) return;
        if (event.key === 'Escape') close();
        if (event.key === 'ArrowLeft') step(-1);
        if (event.key === 'ArrowRight') step(1);
    });
    apply();
}());
`;

const LIGHTBOX = `<div id="lightbox" class="fit" role="dialog" aria-modal="true" aria-label="Screenshot">
<div class="top"><span class="name"></span><span><button type="button" class="prev">&larr;</button> <button type="button" class="next">&rarr;</button> <button type="button" class="fit">Fit / full size</button> <button type="button" class="close">Close (Esc)</button></span></div>
<div class="stage"><img alt=""></div>
</div>`;

const chips = (filter, values) => values.map((value) => `<button type="button" class="chip" data-filter="${filter}" data-value="${escapeHtml(value)}" aria-pressed="false">${escapeHtml(value)}</button>`).join('');

const filterBar = (shots, extra = '') => `<div class="bar">
<input id="search" type="search" placeholder="Filter by screen name" aria-label="Filter by screen name">
<span class="sep"></span>${chips('theme', unique(shots.map((shot) => shot.theme)))}
<span class="sep"></span>${chips('size', unique(shots.map((shot) => shot.size)))}
${extra}<span class="meta" id="count"></span>
</div>`;

const page = ({ title, meta, bar, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${meta.filter(Boolean).map(escapeHtml).join(' &middot; ')}</div>
${bar}
</header>
<main>
${body}
</main>
${LIGHTBOX}
<script>${SCRIPT}</script>
</body>
</html>
`;

const shotButton = (path, label) => `<button type="button" class="shot" data-full="${path}" data-label="${escapeHtml(label)}"><img loading="lazy" src="${path}" alt="${escapeHtml(label)}"></button>`;

const itemAttrs = (shot, extra = '') => `data-item data-screen="${escapeHtml(shot.screen)}" data-theme="${escapeHtml(shot.theme)}" data-size="${escapeHtml(shot.size)}"${extra}`;

const failureList = (failures) => (failures.length
    ? `<ul class="failures">${failures.map((failure) => `<li><strong>${escapeHtml(failure.screen)}</strong>${failure.theme ? ` (${escapeHtml(failure.theme)}, ${escapeHtml(failure.size)})` : ''}: ${escapeHtml(failure.reason)}</li>`).join('')}</ul>`
    : '');

function galleryHtml({ title = 'Screenshot atlas', shots, failures = [], meta = [] }) {
    const cards = shots.map((shot) => {
        const label = `${shot.screen} · ${shot.theme} · ${shot.size}`;
        return `<figure class="card" ${itemAttrs(shot)}>${shotButton(src(shot.file), label)}<figcaption><strong>${escapeHtml(shot.screen)}</strong><span>${escapeHtml(shot.theme)} · ${escapeHtml(shot.size)}</span></figcaption>${shot.note ? `<p class="note">${escapeHtml(shot.note)}</p>` : ''}</figure>`;
    }).join('\n');
    const body = `${failureList(failures)}${shots.length ? `<div class="grid">\n${cards}\n</div>` : '<p class="empty">No screenshots in this folder.</p>'}`;
    return page({ title, meta: [`${shots.length} screenshots`, ...meta], bar: filterBar(shots), body });
}

const percent = (ratio) => (ratio > 0 && ratio < 0.0001 ? '<0.01%' : `${(ratio * 100).toFixed(2)}%`);

const STATUS_NOTE = { added: 'new in after', removed: 'missing in after' };

function compareHtml({ title = 'Atlas compare', rows, meta = [] }) {
    const cell = (folder, row, present) => `<div><div class="label">${folder}</div>${present ? shotButton(src(folder, row.file), `${row.screen} · ${row.theme} · ${row.size} · ${folder}`) : '<div class="none">none</div>'}</div>`;
    const body = rows.map((row) => {
        const changed = row.status !== 'both' || row.changed > 0;
        const amount = row.status === 'both' ? `${percent(row.ratio)} changed` : STATUS_NOTE[row.status];
        return `<section class="row" ${itemAttrs(row, ` data-changed="${changed}"`)}>
<h2>${escapeHtml(row.screen)} <span>${escapeHtml(row.theme)} · ${escapeHtml(row.size)}</span><span class="pct${changed ? ' changed' : ''}">${escapeHtml(amount)}</span></h2>
<div class="trio">${cell('before', row, row.status !== 'added')}${cell('after', row, row.status !== 'removed')}${cell('diff', row, row.status === 'both')}</div>
</section>`;
    }).join('\n');
    const count = (test) => rows.filter(test).length;
    const summary = [
        `${count((row) => row.status === 'both' && row.changed > 0)} changed`,
        `${count((row) => row.status === 'added')} added`,
        `${count((row) => row.status === 'removed')} removed`,
        `${count((row) => row.status === 'both' && !row.changed)} unchanged`,
    ].join(', ');
    const bar = filterBar(rows, '<span class="sep"></span><button type="button" class="chip" data-filter="changedOnly" data-value="yes" aria-pressed="false">Changed only</button>');
    return page({ title, meta: [summary, 'most changed first', ...meta], bar, body: body || '<p class="empty">Nothing to compare.</p>' });
}

module.exports = { escapeHtml, galleryHtml, compareHtml };
