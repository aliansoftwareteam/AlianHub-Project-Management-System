const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { isShareToken, validateIntakeSubmission, escapeHtml } = require('./helpers/shareRules');
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
`;

const htmlPage = (title, body) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head>
<body><div class="wrap">${body}<div class="footer">Shared via AlianHub</div></div></body></html>`;

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

/* GET /share/:token — read-only board grouped by status. */
exports.renderShare = async (req, res) => {
    try {
        const resolved = await resolveShare(req.params.token);
        if (!resolved) {
            return res.status(404).send(htmlPage('Not found', '<h1>This link is not available.</h1>'));
        }
        const { companyId, share } = resolved;

        // Optional password gate (stateless — re-entered per visit).
        if (share.passwordHash) {
            const supplied = (req.body && req.body.password) ? String(req.body.password) : '';
            const ok = supplied && await bcrypt.compare(supplied, share.passwordHash);
            if (!ok) {
                return res.send(htmlPage('Protected', passwordForm(req.params.token, req.method === 'POST')));
            }
        }

        // REP-09 — report shares render a read-only table instead of a task board.
        if (share.entityType === 'report') {
            const rendered = await renderReport(companyId, share);
            return res.send(htmlPage(rendered.title, rendered.body));
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

        return res.send(htmlPage(sprint ? sprint.name : 'Shared board', body));
    } catch (error) {
        logger.error(`ERROR in render public share: ${error.message}`);
        return res.status(500).send(htmlPage('Error', '<h1>Something went wrong.</h1>'));
    }
};

/* POST /share/:token/intake — public form submission. */
exports.submitIntake = async (req, res) => {
    try {
        const resolved = await resolveShare(req.params.token);
        if (!resolved || !resolved.share.allowIntake) {
            return res.status(404).send(htmlPage('Not found', '<h1>This link is not available.</h1>'));
        }
        const { title, description, name, email } = req.body || {};
        const check = validateIntakeSubmission({ title, description, name, email });
        if (!check.valid) {
            return res.status(400).send(htmlPage('Invalid', `<h1>${escapeHtml(check.reason)}</h1><div class="muted"><a href="/share/${escapeHtml(req.params.token)}">Go back</a></div>`));
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
        return res.send(htmlPage('Thanks', `<h1>Thanks — your request was submitted.</h1><div class="muted"><a href="/share/${escapeHtml(req.params.token)}">Back to the board</a></div>`));
    } catch (error) {
        logger.error(`ERROR in submit intake: ${error.message}`);
        return res.status(500).send(htmlPage('Error', '<h1>Something went wrong.</h1>'));
    }
};
