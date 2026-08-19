const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { isShareToken, validateIntakeSubmission, escapeHtml, sanitizeDocHtml } = require('./helpers/shareRules');
const reportRules = require('../CustomReports/helpers/reportRules'); // REP-09 — share saved reports
const bcrypt = require('bcrypt');

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
    /* Every page of the share is in the document; :target picks the one on
       screen, so switching pages costs no reload and no script. The default
       pane is last in source order, which lets a targeted pane hide it with a
       following-sibling selector — no :has() needed, so there is no browser
       where this degrades to a blank page. */
    .pane{display:none;flex:1;min-height:0;flex-direction:column}
    .pane:target{display:flex}
    .pane--default{display:flex}
    .pane:target ~ .pane--default{display:none}
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
    .dk__row{display:flex;align-items:center;gap:6px;padding:6px 10px;margin:1px 4px;border-radius:6px;font-size:13.5px;color:#3b4252;text-decoration:none;overflow:hidden}
    .dk__row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    a.dk__row:hover{background:#f4f5f8}
    .dk__row.is-current{background:#eceef3;font-weight:600;color:#111}
    .dk__caret{display:inline-flex;width:11px;flex:0 0 11px;color:#9aa0b0}
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
    .doc blockquote{margin:0 0 12px;padding:2px 0 2px 14px;border-left:4px solid #e0e0e0;color:#555}
    .doc pre{background:#f6f7f9;border-radius:6px;padding:12px 14px;overflow-x:auto;font-size:13px;white-space:pre-wrap;word-break:break-word}
    .doc img{max-width:100%;height:auto}
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

/* A shared page is read-only and static: no script of ours, and none of theirs.
 * This is the backstop behind sanitizeDocHtml — anything that slipped past the
 * allow-list still has no way to execute. */
const CSP = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// `bare` drops the centred, padded card shell: a docs share is full-bleed, with
// its own breadcrumb bar and sidebar. Boards and reports keep the original shell.
const htmlPage = (title, body, bare) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head>
<body${bare ? ' class="bare"' : ''}><div class="wrap${bare ? ' wrap--bare' : ''}">${body}<div class="footer">Shared via AlianHub</div></div></body></html>`;

/* Every public response goes out with the same locked-down headers. */
const sendPage = (res, status, title, body, bare) => res
    .status(status)
    .set('Content-Security-Policy', CSP)
    .set('X-Content-Type-Options', 'nosniff')
    .set('Referrer-Policy', 'no-referrer')
    .send(htmlPage(title, body, bare));

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

async function renderPage(companyId, share, requestedId) {
    const page = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{ _id: share.entityId }],
    }, 'findOne');
    if (!page || page.deletedStatusKey === 1) {
        return { title: 'Doc', body: '<h1>This doc is no longer available.</h1>' };
    }
    // Marked private after the link was made. Private means private — the link
    // stops working rather than outliving the decision.
    if (String(page.visibility || '') === 'private') {
        return { title: 'Doc', body: '<h1>This doc is no longer shared.</h1>' };
    }

    const tree = orderTree(await collectSharedTree(companyId, page));
    // The id in the URL is attacker-controlled, so it is only honoured when it
    // is provably inside this share's own subtree. Anything else falls back to
    // the root — never fetched — otherwise the token would read any doc in the
    // company by id.
    const wanted = String(requestedId || '');
    const selected = tree.find((n) => n._id === wanted) || tree[0];

    const current = selected._id === String(page._id)
        ? page
        : await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: selected._id, deletedStatusKey: 0 }],
        }, 'findOne');
    if (!current) {
        return { title: 'Doc', body: '<h1>This doc is no longer available.</h1>' };
    }

    // Every page of the subtree is rendered into the one response and switched
    // with :target, so reading a sub-page costs no reload. That only holds while
    // the payload stays sane — beyond these bounds the panes are dropped and
    // each page is fetched from the server as before. The sidebar is repeated
    // per pane (CSS can only restyle the target and what follows it), so the
    // page count matters as much as the content size.
    const INLINE_MAX_PAGES = 25;
    const INLINE_MAX_CONTENT_BYTES = 300 * 1024;

    const docs = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{ _id: { $in: tree.map((n) => n._id) }, deletedStatusKey: 0 }],
    }, 'find').catch(() => []);
    const docById = new Map((docs || []).map((d) => [String(d._id), d]));
    docById.set(String(page._id), page);

    const totalBytes = tree.reduce((sum, n) => {
        const d = docById.get(n._id);
        return sum + String((d && d.content && d.content.html) || '').length;
    }, 0);
    const inline = tree.length > 1
        && tree.length <= INLINE_MAX_PAGES
        && totalBytes <= INLINE_MAX_CONTENT_BYTES
        && tree.every((n) => docById.has(n._id));

    const names = await resolveNames(tree.map((n) => n.ownerId).concat([page.updatedBy, page.createdBy]));
    const byId = new Map(tree.map((n) => [n._id, n]));
    const hasKids = new Set(tree.map((n) => n.parentPageId).filter(Boolean));
    // In-page anchor when everything is inlined, a server round-trip otherwise.
    const link = inline
        ? (id) => `#pg-${escapeHtml(id)}`
        : (id) => `/share/${escapeHtml(share.token)}?p=${escapeHtml(id)}`;

    const paneFor = (node) => {
        const doc = docById.get(node._id) || {};
        const nodeTitle = doc.title || node.title || 'Untitled doc';

        // Breadcrumb: the path from the shared root down to this page. Walked
        // through the tree we already built, so it can never name a page
        // outside this share.
        const trail = [];
        for (let n = node; n; n = byId.get(n.parentPageId)) {
            trail.unshift(n);
            if (!n.parentPageId) break;
        }
        const crumbs = trail.map((n, i) => (i === trail.length - 1
            ? `<span class="crumb is-last">${ICON_DOC}${escapeHtml(n.title || 'Untitled')}</span>`
            : `<a class="crumb" href="${link(n._id)}">${ICON_DOC}${escapeHtml(n.title || 'Untitled')}</a>`
        )).join('<span class="crumb-sep">/</span>');

        let side = '<aside class="dk__side">'
            + '<div class="dk__side-label">Pages</div><div class="dk__tree">';
        for (const row of tree) {
            const isCurrent = row._id === node._id;
            const label = escapeHtml(row.title || 'Untitled');
            const indent = 12 + (row.depth * 16);
            // The caret marks a page that has children. It is decoration, not a
            // control: the whole tree is already expanded, and there is no
            // script on this page to collapse it with.
            const caret = hasKids.has(row._id) ? `<span class="dk__caret">${ICON_CARET}</span>` : '<span class="dk__caret"></span>';
            const inner = `${caret}${ICON_DOC}<span class="dk__row-title">${label}</span>`;
            side += isCurrent
                ? `<span class="dk__row is-current" style="padding-left:${indent}px">${inner}</span>`
                : `<a class="dk__row" style="padding-left:${indent}px" href="${link(row._id)}">${inner}</a>`;
        }
        side += '</div></aside>';

        // Direct children only — the sidebar already carries the whole tree, so
        // this is "what is under the page you are reading", as in ClickUp.
        const children = tree.filter((n) => n.parentPageId === node._id);
        let subpages = '';
        if (children.length) {
            subpages = '<div class="dk__subs"><table><thead><tr><th>Subpages</th><th class="dk__owner-col">Owner</th></tr></thead><tbody>';
            for (const child of children) {
                const who = names.get(child.ownerId) || '';
                subpages += `<tr><td><a class="dk__sub-link" href="${link(child._id)}">${ICON_DOC_BOX}${escapeHtml(child.title || 'Untitled')}</a></td>`
                    + `<td class="dk__owner-col">${who ? avatar(who) : ''}</td></tr>`;
            }
            subpages += '</tbody></table></div>';
        }

        const who = names.get(String(doc.updatedBy || doc.createdBy || '')) || '';
        const meta = `<div class="dk__meta">${who ? `${avatar(who)}<span class="dk__author">${escapeHtml(who)}</span><span class="dk__dot">•</span>` : ''}`
            + `<span class="dk__updated">Last updated ${escapeHtml(formatStamp(doc.updatedAt || doc.createdAt))}</span></div>`;

        const main = '<section class="dk__main"><div class="dk__doc-col">'
            + `<h1 class="dk__title">${escapeHtml(nodeTitle)}</h1>`
            + meta
            + `<div class="doc">${sanitizeDocHtml(doc.content && doc.content.html) || ''}</div>`
            + subpages
            + '</div></section>';

        return `<div class="dk__bar">${crumbs}</div><div class="dk">${side}${main}</div>`;
    };

    const title = (docById.get(selected._id) || {}).title || selected.title || 'Untitled doc';

    if (!inline) {
        return { title, body: paneFor(selected), bare: true };
    }

    // The pane shown when there is no #hash goes LAST and carries the default
    // class: `.pane:target ~ .pane--default` can then hide it as soon as any
    // other pane is targeted. Ordering it this way avoids :has(), so the page
    // does not depend on a selector some browsers may not support — with no
    // fallback a missing :has() would render nothing at all.
    const others = tree.filter((n) => n._id !== selected._id);
    let body = '';
    for (const node of others) body += `<div class="pane" id="pg-${escapeHtml(node._id)}">${paneFor(node)}</div>`;
    body += `<div class="pane pane--default" id="pg-${escapeHtml(selected._id)}">${paneFor(selected)}</div>`;

    return { title, body, bare: true };
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
            return sendPage(res, 200, rendered.title, rendered.body, rendered.bare);
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
