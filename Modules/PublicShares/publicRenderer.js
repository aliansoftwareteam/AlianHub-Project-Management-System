const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { isShareToken, validateIntakeSubmission, escapeHtml, sanitizeDocHtml } = require('./helpers/shareRules');
const reportRules = require('../CustomReports/helpers/reportRules'); // REP-09 — share saved reports
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Unauthenticated public pages, server-rendered as plain HTML so the public
// surface needs no SPA route, login or token. The share token resolves the
// tenant through the GLOBAL publicShareIndex first.

const PAGE_STYLE = `
    body{font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f5f6fa;color:#222;margin:0;padding:24px}
    .wrap{max-width:880px;margin:0 auto}
    h1{font-size:22px;margin:0 0 4px}
    .muted{color:#777;font-size:13px;margin-bottom:20px}
    .group{background:#fff;border:1px solid #e6e6e6;border-radius:10px;margin-bottom:14px;overflow:hidden}
    .group h2{font-size:14px;margin:0;padding:10px 14px;background:#fafafa;border-bottom:1px solid #eee}
    .task{display:flex;justify-content:space-between;gap:12px;padding:9px 14px;border-bottom:1px solid #f2f2f2;font-size:14px}
    .task:last-child{border-bottom:none}
    .key{color:#7b68ee;font-weight:600;white-space:nowrap}
    .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pill{background:#f0f0f0;border-radius:10px;padding:1px 9px;font-size:12px;color:#666;white-space:nowrap}
    form{background:#fff;border:1px solid #e6e6e6;border-radius:10px;padding:16px;margin-top:22px}
    form h2{font-size:15px;margin:0 0 10px}
    label{display:block;font-size:12px;color:#666;margin:10px 0 3px}
    input,textarea{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:8px;font-size:14px;font-family:inherit}
    button{margin-top:14px;background:#7b68ee;border:none;color:#fff;border-radius:6px;padding:9px 18px;font-size:14px;cursor:pointer}
    .footer{margin-top:26px;text-align:center;color:#aaa;font-size:12px}
    /* ── Docs share ────────────────────────────────────────────────────────
       Full-bleed: a breadcrumb bar across the top, the page tree down the left,
       the document on a white sheet to the right. */
    .wrap--bare{max-width:none;margin:0}
    /* The window itself never scrolls: the breadcrumb bar and the footer stay put
       and the two panes scroll on their own. */
    body.bare{padding:0;background:#fff;height:100vh;overflow:hidden}
    body.bare .wrap{display:flex;flex-direction:column;height:100vh;min-height:0}
    body.bare .footer{flex:0 0 auto;margin:0;padding:16px 0 20px;background:#fff;border-top:1px solid #eef0f3}
    /* Thin scrollbars on the panes — Firefox first, then WebKit/Blink. */
    .dk__side,.dk__main{scrollbar-width:thin;scrollbar-color:#d3d6de transparent}
    .dk__side::-webkit-scrollbar,.dk__main::-webkit-scrollbar{width:8px;height:8px}
    .dk__side::-webkit-scrollbar-track,.dk__main::-webkit-scrollbar-track{background:transparent}
    .dk__side::-webkit-scrollbar-thumb,.dk__main::-webkit-scrollbar-thumb{background:#d3d6de;border-radius:8px}
    .dk__side::-webkit-scrollbar-thumb:hover,.dk__main::-webkit-scrollbar-thumb:hover{background:#b9bdc9}
    /* The one live region: the breadcrumb and the body are replaced together
       when another page is opened. */
    .pg-live{display:flex;flex-direction:column;flex:1;min-height:0}
    .pg-live.is-loading{opacity:.55}
    .dk__bar{display:flex;align-items:center;gap:6px;flex:0 0 46px;height:46px;padding:0 16px;border-bottom:1px solid #eef0f3;font-size:13px;background:#fff;overflow:hidden;white-space:nowrap}
    .crumb{display:inline-flex;align-items:center;gap:5px;color:#6b7280;text-decoration:none;max-width:260px;overflow:hidden;text-overflow:ellipsis}
    a.crumb:hover{color:#111}
    .crumb.is-last{color:#111;font-weight:600}
    .crumb-sep{color:#c9ccd6}
    .ic{flex:0 0 auto;opacity:.75;vertical-align:-2px}
    /* min-height:0 is what actually lets the panes below scroll — without it a
       flex child refuses to shrink past its content and the window scrolls instead. */
    .dk{display:flex;align-items:stretch;flex:1;min-height:0;background:#fff}
    .dk__side{flex:0 0 320px;min-height:0;overflow-y:auto;background:#fff;border-right:1px solid #eef0f3;padding:14px 8px 20px}
    .dk__side-label{font-size:12px;color:#8b90a0;padding:2px 10px 8px}
    .dk__tree{display:flex;flex-direction:column}
    /* The row is the highlight and the hit area; the link fills what is left of
       it so the caret beside it stays independently clickable. */
    .dk__item{display:flex;align-items:center;gap:6px;margin:1px 4px;border-radius:6px;overflow:hidden}
    .dk__item:hover{background:#f4f5f8}
    .dk__item.is-current{background:#eceef3}
    .dk__row{flex:1;min-width:0;display:flex;align-items:center;gap:6px;padding:6px 8px 6px 0;font-size:13.5px;color:#3b4252;text-decoration:none;overflow:hidden}
    .dk__item.is-current .dk__row{font-weight:600;color:#111}
    .dk__row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dk__caret{display:inline-flex;align-items:center;justify-content:center;width:14px;height:18px;flex:0 0 14px;color:#9aa0b0}
    .dk__caret--btn{cursor:pointer;border-radius:3px}
    .dk__caret--btn:hover{background:#e2e5ec;color:#4b5162}
    .dk__caret svg{transition:transform .12s ease}
    .dk__item.is-collapsed>.dk__caret svg{transform:rotate(-90deg)}
    .dk__item.is-hidden{display:none}
    /* The whole right-hand pane is the sheet. The column inside only centres the
       text — giving IT the white background left a floating white strip on grey. */
    .dk__main{flex:1;min-width:0;min-height:0;overflow-y:auto;display:flex;justify-content:center;align-items:flex-start;background:#fff;padding:0 40px}
    /* No min-height here: .dk already guarantees a full-height pane, and having
       both stack their own min-height plus padding made a short doc scroll. */
    .dk__doc-col{width:100%;max-width:760px;padding:40px 0 64px}
    .dk__title{font-size:34px;font-weight:700;letter-spacing:-.4px;margin:0 0 12px;line-height:1.2}
    .dk__meta{display:flex;align-items:center;gap:8px;font-size:13px;color:#9aa0b0;margin-bottom:26px}
    .dk__author{color:#4b5162}
    .dk__dot{color:#c9ccd6}
    .dk__avatar{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#7b68ee;color:#fff;font-size:10px;font-weight:700;flex:0 0 20px}
    /* The document sits directly on the sheet — no card inside a card. */
    .dk__doc-col .doc{border:none;border-radius:0;padding:0;background:transparent;font-size:15px;line-height:1.75}
    .dk__subs{margin-top:40px}
    .dk__subs table{width:100%;border-collapse:collapse}
    .dk__subs th{text-align:left;font-size:12.5px;font-weight:500;color:#9aa0b0;padding:0 0 8px;border-bottom:1px solid #eef0f3}
    .dk__subs td{padding:12px 0;border-bottom:1px solid #f2f3f6;font-size:14px}
    .dk__owner-col{width:90px;text-align:left}
    .dk__sub-link{display:inline-flex;align-items:center;gap:10px;color:#111;font-weight:600;text-decoration:none}
    .dk__sub-link:hover{color:#5b4ccc}
    .dk__doc-box{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:#f2f3f6;color:#6b7280;flex:0 0 26px}
    /* Side-by-side needs width; below this the tree sits above the document. */
    /* Stacked, the two panes are no longer side by side, so pane-scrolling makes
       no sense — hand scrolling back to the page or the content is unreachable. */
    @media (max-width:860px){
        body.bare{height:auto;overflow:auto}
        body.bare .wrap{height:auto;min-height:100vh}
        .dk{display:block;min-height:0}
        .dk__side{overflow:visible;border-right:none;border-bottom:1px solid #eef0f3;padding-bottom:10px}
        .dk__main{overflow:visible;padding:0 16px}
        .dk__doc-col{padding:22px 0 40px}
        .dk__title{font-size:26px}
    }
    .doc{background:#fff;border:1px solid #e6e6e6;border-radius:10px;padding:20px 24px;font-size:15px;line-height:1.7}
    .doc>*:first-child{margin-top:0}
    .doc>*:last-child{margin-bottom:0}
    .doc h1,.doc h2,.doc h3,.doc h4{line-height:1.35;margin:22px 0 8px}
    .doc h1{font-size:24px}.doc h2{font-size:20px}.doc h3{font-size:17px}.doc h4{font-size:15px}
    .doc p{margin:0 0 12px}
    .doc ol,.doc ul{margin:0 0 12px;padding-left:26px}
    .doc li{margin:3px 0}
    /* Checklists. The editor writes a checked run and an unchecked run as two
       separate <ul data-checked>, so the marker comes from the list and the
       negative margin keeps consecutive runs reading as one list. */
    .doc ul[data-checked]>li{list-style:none;position:relative}
    .doc ul[data-checked]>li::before{content:'\\2610';position:absolute;left:-21px;top:0;color:#6b7280;font-size:15px}
    .doc ul[data-checked="true"]>li::before{content:'\\2611';color:#4b5162}
    .doc ul[data-checked]+ul[data-checked]{margin-top:-12px}
    .doc blockquote{margin:0 0 12px;padding:2px 0 2px 14px;border-left:4px solid #e0e0e0;color:#555}
    .doc pre{background:#f6f7f9;border-radius:6px;padding:12px 14px;overflow-x:auto;font-size:13px;white-space:pre-wrap;word-break:break-word}
    .doc img{max-width:100%;height:auto}
    /* The editor gives a video no dimensions, so without this an embed collapses
       to a few pixels. 16:9, and it shrinks with the column. */
    .doc iframe.ql-video{display:block;width:100%;max-width:680px;aspect-ratio:16/9;height:auto;min-height:200px;border:0;border-radius:8px;background:#000}
    .doc iframe.ql-video.ql-align-center{margin-left:auto;margin-right:auto}
    .doc iframe.ql-video.ql-align-right{margin-left:auto}
    .doc a{color:#5b4ccc}
    .doc table{border-collapse:collapse}
    .doc td,.doc th{border:1px solid #e6e6e6;padding:6px 10px}
    /* The editor stores alignment and indent as classes, so the public page has to
       understand them too or every centred heading silently goes left. */
    .ql-align-center{text-align:center}.ql-align-right{text-align:right}.ql-align-justify{text-align:justify}
    .ql-indent-1{padding-left:3em}.ql-indent-2{padding-left:6em}.ql-indent-3{padding-left:9em}
    .ql-indent-4{padding-left:12em}.ql-indent-5{padding-left:15em}
`;

/* Inline SVG rather than an icon font or image: the CSP forbids outside
 * requests, and these are markup, not script. */
const ICON_DOC = '<svg class="ic" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M9.5 1H4a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5V5L9.5 1Zm0 1.6L11.9 5H9.5V2.6ZM5 7.5h6v1H5v-1Zm0 3h6v1H5v-1Z"/></svg>';
const ICON_DOC_BOX = '<span class="dk__doc-box">' + ICON_DOC + '</span>';
const ICON_CARET = '<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><path fill="currentColor" d="M2 4l4 4 4-4z"/></svg>';

/* One script of ours, none of theirs.
 *
 * script-src carries a per-response nonce and never 'unsafe-inline', so the
 * navigation script below runs while anything injected does not: an attacker
 * cannot guess the nonce, and inline handlers (onclick=) stay blocked outright.
 * That keeps the backstop behind sanitizeDocHtml — which already strips <script>
 * and every on* attribute by allow-list — rather than trading it away.
 *
 * connect-src 'self' is what lets the page fetch another doc page; nothing else
 * may be reached. */
const EMBED_HOSTS = 'https://www.youtube.com https://youtube.com https://www.youtube-nocookie.com '
    + 'https://player.vimeo.com https://www.loom.com https://loom.com';

const cspFor = (nonce) => "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; "
    + `script-src 'nonce-${nonce}'; connect-src 'self'; `
    // Video embeds only, and only the players sanitizeDocHtml already accepts —
    // two independent gates on the same short list.
    + `frame-src ${EMBED_HOSTS}; `
    + "form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// `bare` drops the centred, padded card shell: a docs share is full-bleed, with
// its own breadcrumb bar and sidebar. Boards and reports keep the original shell.
/* Opens another page of the share without reloading: fetch its markup, swap the
 * live region, and move the address bar with history so back/forward and a
 * copied URL keep working.
 *
 * Progressive enhancement — every link is a real href, so with this script
 * blocked, failed or unsupported the page still navigates, just with a reload.
 * Only the page being read is ever fetched, which is why a shared doc can be
 * any size. */
const NAV_SCRIPT = (token) => `
(function () {
  var live = document.getElementById('pg-live');
  if (!live || !window.fetch || !window.history || !history.pushState) return;
  var base = '/share/${token}';
  var busy = false;
  // Which branches the reader folded away. Kept here rather than in the markup
  // because every page swap replaces the sidebar, and a collapsed tree that
  // sprang open again on each click would be worse than not collapsing at all.
  var collapsed = Object.create(null);
  function applyCollapse() {
    var items = live.querySelectorAll('.dk__item');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      it.classList.remove('is-collapsed', 'is-hidden');
      if (collapsed[it.getAttribute('data-id')]) it.classList.add('is-collapsed');
      var anc = (it.getAttribute('data-anc') || '').split(' ');
      for (var j = 0; j < anc.length; j++) {
        if (anc[j] && collapsed[anc[j]]) { it.classList.add('is-hidden'); break; }
      }
    }
  }
  function toggle(id) {
    if (collapsed[id]) delete collapsed[id]; else collapsed[id] = true;
    applyCollapse();
  }
  function show(data, id, push) {
    live.innerHTML = '<div class="dk__bar">' + data.bar + '</div>' + data.body;
    document.title = data.title;
    var url = id ? base + '?p=' + encodeURIComponent(id) : base;
    if (push) history.pushState({ p: id }, '', url);
    applyCollapse();
  }
  function open(id, push) {
    if (busy) return;
    busy = true;
    live.className = 'pg-live is-loading';
    fetch(base + '/page/' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) { show(data, id, push); })
      .catch(function () { window.location.href = base + '?p=' + encodeURIComponent(id); })
      .then(function () { busy = false; live.className = 'pg-live'; });
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || !e.target.closest) return;
    // The twisty is checked first and returns: folding a branch must never also
    // open the page sitting next to it.
    var t = e.target.closest('.dk__caret[data-toggle]');
    if (t) { e.preventDefault(); toggle(t.getAttribute('data-toggle')); return; }
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a[data-pg]');
    if (!a) return;
    e.preventDefault();
    open(a.getAttribute('data-pg'), true);
  });
  // The twisty carries role="button", so it owes the keyboard the same action.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target.closest ? e.target.closest('.dk__caret[data-toggle]') : null;
    if (!t) return;
    e.preventDefault();
    toggle(t.getAttribute('data-toggle'));
  });
  window.addEventListener('popstate', function (e) {
    var id = e.state && e.state.p;
    if (id) open(id, false); else window.location.reload();
  });
})();`;

const htmlPage = (title, body, bare, opts) => {
    const o = opts || {};
    const script = o.live && o.nonce
        ? `<script nonce="${o.nonce}">${NAV_SCRIPT(escapeHtml(o.token || ''))}</` + 'script>'
        : '';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head>
<body${bare ? ' class="bare"' : ''}><div class="wrap${bare ? ' wrap--bare' : ''}">${body}<div class="footer">Shared via AlianHub</div></div>${script}</body></html>`;
};

/* Every public response goes out with the same locked-down headers. The nonce is
 * generated per response — a fixed one would be as good as 'unsafe-inline'. */
const sendPage = (res, status, title, body, bare, opts) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    return res
        .status(status)
        .set('Content-Security-Policy', cspFor(nonce))
        .set('X-Content-Type-Options', 'nosniff')
        .set('Referrer-Policy', 'no-referrer')
        .send(htmlPage(title, body, bare, { ...(opts || {}), nonce }));
};

// Password gate (server-rendered) shown when a share is password-protected.
const passwordForm = (token, wrong) => `<h1>Password required</h1>
    <div class="muted">This shared view is password-protected.</div>
    ${wrong ? '<div class="muted" style="color:#c0392b">Incorrect password — please try again.</div>' : ''}
    <form method="POST" action="/share/${escapeHtml(token)}">
        <label>Password</label><input name="password" type="password" autofocus>
        <button type="submit">View</button>
    </form>`;

/* Token -> { companyId, share } or null. */
async function resolveShare(token) {
    if (!isShareToken(token)) return null;
    const index = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.PUBLIC_SHARE_INDEX,
        data: [{ token }],
    }, 'findOne');
    if (!index) return null;
    const share = await MongoDbCrudOpration(index.companyId, {
        type: SCHEMA_TYPE.PUBLIC_SHARES,
        data: [{ _id: index.shareId }],
    }, 'findOne');
    if (!share || share.enabled === false) return null;
    if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) return null;
    return { companyId: index.companyId, share };
}

// --- REP-09: report shares — a read-only public view of a saved report (REP-02). ---
const DIM_LABELS = { status: 'Status', project: 'Project', sprint: 'Sprint' };
const METRIC_LABELS = { count: 'Task count', points: 'Story points' };

async function runReportRows(companyId, cfg) {
    const pipeline = reportRules.buildPipeline(cfg);
    const raw = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [pipeline] }, 'aggregate');
    return (raw || []).map((r) => ({ label: (r._id === null || r._id === undefined || r._id === '') ? '(none)' : String(r._id), value: r.value || 0 }));
}

async function renderReport(companyId, share) {
    const report = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ _id: share.entityId }],
    }, 'findOne');
    if (!report || report.deletedStatusKey === 1) {
        return { title: 'Report', body: '<h1>This report is no longer available.</h1>' };
    }
    // Resolve through the same whitelist engine — never raw fields.
    const check = reportRules.validateConfig(report);
    const rows = check.valid ? await runReportRows(companyId, check.value) : [];
    const total = rows.reduce((a, r) => a + (r.value || 0), 0);
    const dimLabel = DIM_LABELS[check.value && check.value.dimension] || 'Group';
    const metricLabel = METRIC_LABELS[check.value && check.value.metric] || 'Value';
    let body = `<h1>${escapeHtml(report.name)}</h1>`;
    body += '<div class="muted">read-only public report</div>';
    body += `<div class="group"><h2>${escapeHtml(dimLabel)} · ${escapeHtml(metricLabel)}</h2>`;
    if (!rows.length) body += '<div class="task"><span class="name">No data.</span></div>';
    rows.forEach((r) => { body += `<div class="task"><span class="name">${escapeHtml(r.label)}</span><span class="pill">${escapeHtml(r.value)}</span></div>`; });
    body += `<div class="task"><span class="name"><b>Total</b></span><span class="pill"><b>${escapeHtml(total)}</b></span></div>`;
    body += '</div>';
    return { title: report.name, body };
}

/**
 * A shared doc — the document itself, read-only, for anyone with the link.
 *
 * The body is member-authored HTML, so it goes through the allow-list before it
 * reaches the page (see sanitizeDocHtml) and the page is served under a CSP that
 * permits no script at all.
 */
// Sharing a doc shares the doc AND everything nested under it, to any depth.
// Walked level by level from the shared root rather than recursively per page,
// so depth costs one query per level instead of one per node.
//
// Two bounds, because this is reachable without a login: a `visited` set (a
// corrupt parent chain could otherwise loop forever) and a hard page cap.
const SHARED_TREE_MAX_DEPTH = 12;
const SHARED_TREE_MAX_PAGES = 500;

async function collectSharedTree(companyId, rootPage) {
    const nodes = [{ _id: String(rootPage._id), title: rootPage.title, depth: 0 }];
    const visited = new Set([String(rootPage._id)]);
    let frontier = [rootPage._id];

    for (let depth = 1; depth <= SHARED_TREE_MAX_DEPTH && frontier.length; depth += 1) {
        // A private sub-page stays private: excluded here, and because the walk
        // never descends into what it excluded, its own children stay out too.
        // eslint-disable-next-line no-await-in-loop
        const children = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [
                { parentPageId: { $in: frontier }, deletedStatusKey: 0, visibility: { $ne: 'private' } },
                'title parentPageId order updatedBy createdBy',
                { sort: { order: 1 } },
            ],
        }, 'find').catch(() => []);

        const next = [];
        for (const child of (children || [])) {
            const id = String(child._id);
            if (visited.has(id) || nodes.length >= SHARED_TREE_MAX_PAGES) continue;
            visited.add(id);
            nodes.push({
                _id: id,
                title: child.title,
                depth,
                parentPageId: String(child.parentPageId || ''),
                ownerId: String(child.updatedBy || child.createdBy || ''),
            });
            next.push(child._id);
        }
        frontier = next;
    }
    return nodes;
}

// Order the flat level-by-level list so each page is followed by its own
// children — the reading order of the tree, not the order it was fetched in.
function orderTree(nodes) {
    const byParent = new Map();
    for (const n of nodes.slice(1)) {
        const key = n.parentPageId || '';
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(n);
    }
    const out = [];
    const walk = (node) => {
        out.push(node);
        for (const child of (byParent.get(node._id) || [])) walk(child);
    };
    walk(nodes[0]);
    return out;
}

/**
 * Resolve everything a doc share needs to render one page: the shared subtree,
 * which page was asked for, that page's document, and the display names.
 *
 * ONLY the requested page's content is loaded. The tree carries titles, not
 * bodies, so the work here is independent of how large the other pages are —
 * a shared doc can be any size.
 */
async function buildDocContext(companyId, share, requestedId) {
    const page = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{ _id: share.entityId }],
    }, 'findOne');
    if (!page || page.deletedStatusKey === 1) return { error: 'This doc is no longer available.' };
    // Marked private after the link was made. Private means private — the link
    // stops working rather than outliving the decision.
    if (String(page.visibility || '') === 'private') return { error: 'This doc is no longer shared.' };

    const tree = orderTree(await collectSharedTree(companyId, page));
    // The id in the request is attacker-controlled, so it is only honoured when
    // it is provably inside this share's own subtree. Anything else falls back
    // to the root — never fetched — otherwise the token would read any doc in
    // the company by id.
    const wanted = String(requestedId || '');
    const selected = tree.find((n) => n._id === wanted) || tree[0];

    const current = selected._id === String(page._id)
        ? page
        : await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: selected._id, deletedStatusKey: 0 }],
        }, 'findOne');
    if (!current) return { error: 'This doc is no longer available.' };

    // One lookup for the byline plus every row of the subpages table.
    const children = tree.filter((n) => n.parentPageId === selected._id);
    const names = await resolveNames(
        children.map((c) => c.ownerId).concat([current.updatedBy, current.createdBy]),
    );

    return { tree, selected, current, children, names, byId: new Map(tree.map((n) => [n._id, n])) };
}

/* The breadcrumb bar and the sidebar+document body for one page. Returned
 * separately so the client can swap them without touching the page shell. */
function renderDocPane(share, ctx) {
    const { tree, selected, current, children, names, byId } = ctx;
    const hasKids = new Set(tree.map((n) => n.parentPageId).filter(Boolean));
    const title = current.title || 'Untitled doc';
    // A real URL, so the link works when opened directly, copied, or when the
    // script below never runs. data-pg lets the script recognise it without
    // parsing anything.
    const link = (id) => `/share/${escapeHtml(share.token)}?p=${escapeHtml(id)}`;

    const trail = [];
    for (let n = selected; n; n = byId.get(n.parentPageId)) {
        trail.unshift(n);
        if (!n.parentPageId) break;
    }
    const crumbs = trail.map((n, i) => (i === trail.length - 1
        ? `<span class="crumb is-last">${ICON_DOC}${escapeHtml(n.title || 'Untitled')}</span>`
        : `<a class="crumb" data-pg="${escapeHtml(n._id)}" href="${link(n._id)}">${ICON_DOC}${escapeHtml(n.title || 'Untitled')}</a>`
    )).join('<span class="crumb-sep">/</span>');

    // Ancestor ids per row, so collapsing a branch can hide everything beneath it
    // without the client having to rebuild the tree.
    const ancestorsOf = (node) => {
        const out = [];
        for (let n = byId.get(node.parentPageId); n; n = byId.get(n.parentPageId)) {
            out.push(n._id);
            if (!n.parentPageId) break;
        }
        return out;
    };

    let side = '<aside class="dk__side"><div class="dk__side-label">Pages</div><div class="dk__tree">';
    for (const row of tree) {
        const isCurrent = row._id === selected._id;
        const label = escapeHtml(row.title || 'Untitled');
        const indent = 12 + (row.depth * 16);
        // The caret is a SIBLING of the link, never inside it — nested in the
        // anchor, every click on the twisty also opened the page.
        const caret = hasKids.has(row._id)
            ? `<span class="dk__caret dk__caret--btn" data-toggle="${escapeHtml(row._id)}" role="button" tabindex="0" aria-label="Show or hide sub-pages">${ICON_CARET}</span>`
            : '<span class="dk__caret"></span>';
        const body = `${ICON_DOC}<span class="dk__row-title">${label}</span>`;
        const target = isCurrent
            ? `<span class="dk__row">${body}</span>`
            : `<a class="dk__row" data-pg="${escapeHtml(row._id)}" href="${link(row._id)}">${body}</a>`;
        side += `<div class="dk__item${isCurrent ? ' is-current' : ''}" data-id="${escapeHtml(row._id)}"`
            + ` data-anc="${escapeHtml(ancestorsOf(row).join(' '))}" style="padding-left:${indent}px">${caret}${target}</div>`;
    }
    side += '</div></aside>';

    // Direct children only — the sidebar already carries the whole tree, so this
    // is "what is under the page you are reading", as in ClickUp.
    let subpages = '';
    if (children.length) {
        subpages = '<div class="dk__subs"><table><thead><tr><th>Subpages</th><th class="dk__owner-col">Owner</th></tr></thead><tbody>';
        for (const child of children) {
            const who = names.get(child.ownerId) || '';
            subpages += `<tr><td><a class="dk__sub-link" data-pg="${escapeHtml(child._id)}" href="${link(child._id)}">${ICON_DOC_BOX}${escapeHtml(child.title || 'Untitled')}</a></td>`
                + `<td class="dk__owner-col">${who ? avatar(who) : ''}</td></tr>`;
        }
        subpages += '</tbody></table></div>';
    }

    const who = names.get(String(current.updatedBy || current.createdBy || '')) || '';
    const meta = `<div class="dk__meta">${who ? `${avatar(who)}<span class="dk__author">${escapeHtml(who)}</span><span class="dk__dot">•</span>` : ''}`
        + `<span class="dk__updated">Last updated ${escapeHtml(formatStamp(current.updatedAt || current.createdAt))}</span></div>`;

    const main = '<section class="dk__main"><div class="dk__doc-col">'
        + `<h1 class="dk__title">${escapeHtml(title)}</h1>`
        + meta
        + `<div class="doc">${sanitizeDocHtml(current.content && current.content.html) || ''}</div>`
        + subpages
        + '</div></section>';

    return { title, bar: crumbs, body: `<div class="dk">${side}${main}</div>` };
}

async function renderPage(companyId, share, requestedId) {
    const ctx = await buildDocContext(companyId, share, requestedId);
    if (ctx.error) return { title: 'Doc', body: `<h1>${escapeHtml(ctx.error)}</h1>` };
    const pane = renderDocPane(share, ctx);
    return {
        title: pane.title,
        body: `<div id="pg-live" class="pg-live"><div class="dk__bar">${pane.bar}</div>${pane.body}</div>`,
        bare: true,
        // Swapping pages in the browser is pointless behind a password: the gate
        // is stateless and re-asked per request, so the fragment endpoint refuses
        // and every navigation would have to reload anyway.
        live: !share.passwordHash,
        pageId: ctx.selected._id,
    };
}

/* Display names for a set of user ids, in ONE query — the subpages table would
 * otherwise issue a lookup per row. Users live in the GLOBAL db, not the company
 * one. Best-effort throughout: a name that cannot be resolved is simply omitted
 * rather than failing the page. */
async function resolveNames(userIds) {
    const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
    const out = new Map();
    if (!ids.length) return out;
    try {
        const users = await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: { $in: ids } }, 'Employee_Name Employee_FName Employee_LName'],
        }, 'find');
        for (const u of (users || [])) {
            const name = u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' ');
            if (name) out.set(String(u._id), String(name));
        }
    } catch (e) { /* names are decoration — never fail the page for them */ }
    return out;
}

async function resolveOwner(page) {
    const uid = String(page.updatedBy || page.createdBy || '');
    const names = await resolveNames([uid]);
    return { name: names.get(uid) || '' };
}

// Initial-in-a-circle. Real avatars live behind signed storage URLs that would
// expire on a public page, so the initial is the honest version.
const avatar = (name) => {
    const initial = escapeHtml(String(name || '?').trim().charAt(0).toUpperCase() || '?');
    return `<span class="dk__avatar">${initial}</span>`;
};

const formatStamp = (value) => {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return 'unknown';
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date} at ${time}`;
};

/* GET /share/:token/page/:pageId — one page of a shared doc, as JSON, for the
 * in-page navigation. Everything the full render enforces is enforced here too:
 * this is a second door into the same data, not a shortcut past the checks.
 *
 * The requested id is validated against the share's own subtree by
 * buildDocContext, which falls back to the root rather than fetching anything
 * outside it, and the content is sanitised by the same renderer. */
exports.renderDocFragment = async (req, res) => {
    try {
        const resolved = await resolveShare(req.params.token);
        if (!resolved) return res.status(404).json({ error: 'not found' });
        const { companyId, share } = resolved;
        if (share.entityType !== 'page') return res.status(404).json({ error: 'not found' });
        // The password gate is stateless and re-asked per request, so there is no
        // unlocked session for this endpoint to trust. Refuse and let the browser
        // fall back to a full navigation, which asks for the password properly.
        if (share.passwordHash) return res.status(403).json({ error: 'password required' });

        const ctx = await buildDocContext(companyId, share, req.params.pageId);
        if (ctx.error) return res.status(404).json({ error: ctx.error });
        const pane = renderDocPane(share, ctx);
        return res
            .set('Content-Security-Policy', "default-src 'none'")
            .set('X-Content-Type-Options', 'nosniff')
            .set('Referrer-Policy', 'no-referrer')
            .set('Cache-Control', 'no-store')
            .json({ title: pane.title, bar: pane.bar, body: pane.body, id: ctx.selected._id });
    } catch (error) {
        logger.error(`ERROR in render doc fragment: ${error.message}`);
        return res.status(500).json({ error: 'failed' });
    }
};

/* GET /share/:token — read-only board grouped by status. */
exports.renderShare = async (req, res) => {
    try {
        const resolved = await resolveShare(req.params.token);
        if (!resolved) {
            return sendPage(res, 404, 'Not found', '<h1>This link is not available.</h1>');
        }
        const { companyId, share } = resolved;

        // Optional password gate (stateless — re-entered per visit).
        if (share.passwordHash) {
            const supplied = (req.body && req.body.password) ? String(req.body.password) : '';
            const ok = supplied && await bcrypt.compare(supplied, share.passwordHash);
            if (!ok) {
                return sendPage(res, 200, 'Protected', passwordForm(req.params.token, req.method === 'POST'));
            }
        }

        // REP-09 — report shares render a read-only table instead of a task board.
        if (share.entityType === 'report') {
            const rendered = await renderReport(companyId, share);
            return sendPage(res, 200, rendered.title, rendered.body);
        }

        // A shared doc renders the document itself, plus everything nested under
        // it. `?p=` picks which page of that subtree to show; renderPage rejects
        // any id that is not inside it.
        if (share.entityType === 'page') {
            const rendered = await renderPage(companyId, share, req.query && req.query.p);
            return sendPage(res, 200, rendered.title, rendered.body, rendered.bare, {
                live: rendered.live, token: share.token,
            });
        }

        const [sprint, tasks] = await Promise.all([
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.SPRINTS,
                data: [{ _id: share.entityId }, 'name'],
            }, 'findOne'),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [
                    { sprintId: share.entityId, deletedStatusKey: 0, isParentTask: true },
                    'TaskKey TaskName status Task_Priority',
                    { sort: { updatedAt: -1 }, limit: 300 },
                ],
            }, 'find'),
        ]);

        const groups = new Map();
        (tasks || []).forEach((task) => {
            const label = (task.status && task.status.text) || 'Other';
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(task);
        });

        let body = `<h1>${escapeHtml(sprint ? sprint.name : 'Shared board')}</h1>`;
        body += `<div class="muted">${(tasks || []).length} tasks · read-only public view</div>`;
        if (!groups.size) {
            body += '<div class="group"><div class="task">No tasks here yet.</div></div>';
        }
        groups.forEach((items, label) => {
            body += `<div class="group"><h2>${escapeHtml(label)} (${items.length})</h2>`;
            items.forEach((task) => {
                body += `<div class="task"><span class="key">${escapeHtml(task.TaskKey || '')}</span><span class="name">${escapeHtml(task.TaskName || '')}</span><span class="pill">${escapeHtml(task.Task_Priority || '')}</span></div>`;
            });
            body += '</div>';
        });

        if (share.allowIntake) {
            body += `<form method="POST" action="/share/${escapeHtml(share.token)}/intake">
                <h2>Submit a request</h2>
                <label>Title *</label><input name="title" maxlength="200" required>
                <label>Details</label><textarea name="description" rows="4" maxlength="5000"></textarea>
                <label>Your name</label><input name="name" maxlength="120">
                <label>Email</label><input name="email" type="email" maxlength="120">
                <button type="submit">Send</button>
            </form>`;
        }

        return sendPage(res, 200, sprint ? sprint.name : 'Shared board', body);
    } catch (error) {
        logger.error(`ERROR in render public share: ${error.message}`);
        return sendPage(res, 500, 'Error', '<h1>Something went wrong.</h1>');
    }
};

/* POST /share/:token/intake — public form submission. */
exports.submitIntake = async (req, res) => {
    try {
        const resolved = await resolveShare(req.params.token);
        if (!resolved || !resolved.share.allowIntake) {
            return sendPage(res, 404, 'Not found', '<h1>This link is not available.</h1>');
        }
        const { title, description, name, email } = req.body || {};
        const check = validateIntakeSubmission({ title, description, name, email });
        if (!check.valid) {
            return sendPage(res, 400, 'Invalid', `<h1>${escapeHtml(check.reason)}</h1><div class="muted"><a href="/share/${escapeHtml(req.params.token)}">Go back</a></div>`);
        }
        await MongoDbCrudOpration(resolved.companyId, {
            type: SCHEMA_TYPE.INTAKE_ITEMS,
            data: {
                publicShareId: new mongoose.Types.ObjectId(resolved.share._id),
                title: String(title).trim(),
                description: description ? String(description) : '',
                name: name ? String(name) : '',
                email: email ? String(email) : '',
                status: 'pending',
            },
        }, 'save');
        return sendPage(res, 200, 'Thanks', `<h1>Thanks — your request was submitted.</h1><div class="muted"><a href="/share/${escapeHtml(req.params.token)}">Back to the board</a></div>`);
    } catch (error) {
        logger.error(`ERROR in submit intake: ${error.message}`);
        return sendPage(res, 500, 'Error', '<h1>Something went wrong.</h1>');
    }
};
