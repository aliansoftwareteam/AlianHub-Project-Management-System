const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { isShareToken, escapeHtml } = require('../PublicShares/helpers/shareRules');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo'); // canonical task create
const { mapSubmission, buildDescription, buildDescriptionBlock } = require('./helpers/submissionRules');
const { normalizeSettings, hydrateStored } = require('./helpers/formRules');
const { typeOf, resolveSpan, GRID_COLUMNS } = require('./helpers/questionTypes');

// The public half of Forms: an unauthenticated page, and the submission that
// becomes a task.
//
// Server-rendered rather than an SPA route, matching the shared docs: no login,
// no bundle, and a policy that forbids scripts outright — every widget here is
// one the browser renders on its own, so the page needs none. That constraint is
// why conditional logic, one-question-per-page and a signature pad are not
// offered: each would need script on a page anonymous traffic can reach.

/* No script of ours, and none of theirs. The page is built from escaped values,
 * and this is the backstop if any of them were ever missed. */
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; "
    + "base-uri 'none'; frame-ancestors 'none'";

const PAGE_STYLE = `
    *{box-sizing:border-box}
    body{font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:32px 16px}
    .wrap{max-width:760px;margin:0 auto}
    .card{border-radius:12px;padding:28px}
    .head{margin:0 0 22px}
    .head--left{text-align:left}
    .head--center{text-align:center}
    .head--right{text-align:right}
    .head--rule{padding-bottom:16px;border-bottom:1px solid #e6e6e6}
    h1{font-size:22px;margin:0 0 6px;line-height:1.3}
    .intro{font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap}
    /* An even row gap, so a field carrying an error message does not crowd the
       row beneath it. The label owns the space above each control. */
    .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:18px 24px}
    /* Width per question, in twelfths, so one row can hold halves, thirds or
       quarters. */
    .q{min-width:0;grid-column:span 12}
    .q--3{grid-column:span 3}
    .q--4{grid-column:span 4}
    .q--6{grid-column:span 6}
    .q--12{grid-column:span 12}
    label,.qlabel{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
    .req{color:#c0392b;margin-left:2px}
    .help{display:block;font-weight:400;font-size:12px;margin-top:2px}
    input[type=text],input[type=date],input[type=email],input[type=url],input[type=tel],
    input[type=number],textarea,select{width:100%;border:1px solid #d7d9e6;border-radius:7px;
        padding:9px 11px;font-size:14px;font-family:inherit}
    textarea{min-height:104px;resize:vertical}
    input:focus,textarea:focus,select:focus{outline:2px solid #c9d0f5;outline-offset:0;border-color:#7b8ce0}
    input[type=range]{width:100%}
    .choices{display:flex;flex-wrap:wrap;gap:8px 18px}
    .choice{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:400;margin:0}
    .choice input{margin:0}
    /* Stars are radios: a rating needs no script, only a label per value. */
    .stars{display:flex;gap:6px}
    .stars input{position:absolute;opacity:0;pointer-events:none}
    .stars label{margin:0;cursor:pointer;font-size:24px;line-height:1;color:#c9ccdb}
    .stars input:checked+label,.stars label:hover{color:#f5a623}
    .money{display:flex;align-items:center;gap:0}
    .money .sym{border:1px solid #d7d9e6;border-right:0;border-radius:7px 0 0 7px;padding:9px 11px;font-size:14px}
    .money input{border-radius:0 7px 7px 0}
    .info{border-left:3px solid #c9d0f5;padding:2px 0 2px 12px;margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap}
    /* Two classes deep on purpose: themeStyle is appended after this block and
       re-sets border-color on input[type=...] selectors of equal specificity, so a
       single .bad lost to it on every input — and only the textarea, whose theme
       selector is weaker, kept its red border. */
    .q.bad input,.q.bad textarea,.q.bad select{border-color:#e2645c;background:#fffbfb}
    .q.bad input:focus,.q.bad textarea:focus,.q.bad select:focus{outline-color:#f3c9c5}
    .err-line{display:flex;align-items:center;gap:5px;color:#c0392b;font-size:12px;margin-top:6px}
    .err-line svg{flex:0 0 13px;width:13px;height:13px}
    button{margin-top:26px;border:none;color:#fff;border-radius:8px;padding:12px 22px;font-size:14px;
        font-weight:600;cursor:pointer;width:100%}
    button:hover{filter:brightness(.94)}
    .again{display:inline-block;margin-top:14px;font-size:13px;text-decoration:none;border-radius:7px;padding:8px 14px;border:1px solid #d7d9e6}
    .note{margin-top:18px;font-size:13px;padding:11px 13px;border-radius:8px}
    .note.err{background:#fdf1f0;color:#a33227;border:1px solid #f0cfcb}
    /* Sent confirmation. The form stays on screen so another submission needs no
       navigation, and the banner takes itself away after a couple of seconds.
       Done in CSS because this page runs no script — the policy forbids it. */
    .note.ok{display:flex;align-items:center;gap:9px;background:#eef8f2;color:#1c6b41;border:1px solid #c8e6d5;
        overflow:hidden;animation:sent-away .45s ease 2s forwards}
    .note.ok .tick{flex:0 0 20px;width:20px;height:20px;border-radius:50%;background:#1c7a43;color:#fff;
        display:flex;align-items:center;justify-content:center;font-size:12px}
    @keyframes sent-away{
        to{opacity:0;visibility:hidden;max-height:0;margin-top:0;padding-top:0;padding-bottom:0;border-width:0}
    }
    @media (prefers-reduced-motion:reduce){.note.ok{animation-duration:.01s}}
    .footer{margin-top:22px;text-align:center;font-size:12px}
    /* One per row on a phone: thirds and quarters are unusable at that width. */
    @media (max-width:640px){.q,.q--3,.q--4,.q--6{grid-column:span 12}}
`;

/* The author's choices, as the few values the stylesheet varies by. Kept to
 * colours and a column count so a form cannot style itself into something the
 * escaping above does not cover. */
const themeStyle = (s) => {
    const dark = s.theme === 'dark';
    const ink = dark ? '#e8e9f0' : '#222';
    const muted = dark ? '#9aa0b4' : '#6b7280';
    const surface = dark ? '#1f2130' : '#fff';
    const edge = dark ? '#343850' : '#e6e6e6';
    return `
    body{background:${s.background};color:${ink}}
    .card{background:${surface};border:1px solid ${edge}}
    .head--rule{border-bottom-color:${edge}}
    .intro,.help,.footer{color:${muted}}
    input[type=text],input[type=date],input[type=email],input[type=url],input[type=tel],
    input[type=number],textarea,select,.money .sym,.again{background:${surface};color:${ink};
        border-color:${dark ? '#3b3f5a' : '#d7d9e6'}}
    .again{color:${ink}}
    button{background:${s.buttonColor}}`;
};

const page = (title, body, settings) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}${themeStyle(settings)}</style></head>
<body><div class="wrap"><div class="card">${body}</div>
${settings.hideBranding ? '' : '<div class="footer">Powered by AlianHub</div>'}</div></body></html>`;

const send = (res, status, title, body, settings) => res
    .status(status)
    .set('Content-Security-Policy', CSP)
    .set('X-Content-Type-Options', 'nosniff')
    .set('Referrer-Policy', 'no-referrer')
    .set('Cache-Control', 'no-store')
    .send(page(title, body, settings || normalizeSettings({})));

/* Inline, because the page loads no external asset of any kind. */
const ERROR_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<circle cx="8" cy="8" r="7" fill="#c0392b"/>'
    + '<rect x="7.1" y="4" width="1.8" height="5" rx=".9" fill="#fff"/>'
    + '<circle cx="8" cy="11.4" r="1" fill="#fff"/></svg>';

const gone = (res) => send(res, 404, 'Not available', '<h1>This form is not available.</h1>');

/* Where a completed submission is sent.
 *
 * Answering the POST with HTML left the browser's current history entry as a
 * POST, so a reload re-sent it and filed the submission a second time — and the
 * browser asked "Confirm Form Resubmission" to do it. Redirecting to a plain GET
 * makes the reloadable page a GET, which is idempotent. 303 rather than 302 so
 * every client turns it into a GET rather than repeating the method. */
const SENT_QUERY = 'sent=1';
const redirectAfterSubmit = (res, token) => res
    .set('Cache-Control', 'no-store')
    .redirect(303, `/form/${encodeURIComponent(token)}?${SENT_QUERY}`);

/* The confirmation banner. Shared, so the GET that follows a submission and any
 * other caller cannot word it differently. */
const sentBanner = (form) => {
    const thanks = form.successMessage || 'Thanks - your submission has been received.';
    return `<div class="note ok"><span class="tick">&#10003;</span><span>${escapeHtml(thanks)}</span></div>`;
};

/* Resolve token -> tenant -> form. The GLOBAL index exists because a public
 * request carries no company: the token has to name the tenant first. */
async function resolveForm(token) {
    if (!isShareToken(token)) return null;
    const index = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.PUBLIC_SHARE_INDEX, data: [{ token }],
    }, 'findOne');
    if (!index) return null;
    const share = await MongoDbCrudOpration(index.companyId, {
        type: SCHEMA_TYPE.PUBLIC_SHARES, data: [{ _id: index.shareId }],
    }, 'findOne');
    if (!share || share.entityType !== 'form' || share.enabled === false) return null;
    if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) return null;

    const form = await MongoDbCrudOpration(index.companyId, {
        type: SCHEMA_TYPE.FORMS, data: [{ _id: share.entityId, deletedStatusKey: 0 }],
    }, 'findOne');
    // Unpublished means the link stops working, even though the share row lives
    // on so re-publishing keeps the same url.
    if (!form || form.state !== 'live') return null;
    return { companyId: index.companyId, form };
}

/* One reading of the stored list, used for rendering AND for mapping, so the
 * page can never show a question the submission handler then ignores. */
const liveForm = (form) => {
    const doc = (form && form.toObject) ? form.toObject() : form;
    return { ...doc, questions: hydrateStored(doc.questions) };
};

const visibleQuestions = (form) => form.questions
    .filter((q) => !q.hidden)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));

/* An answer echoed back after a rejected submission, so a long form is not
 * retyped. Multi-value answers arrive as arrays. */
const echoed = (values, id) => {
    const v = values && values[id];
    if (v === undefined || v === null) return [];
    return (Array.isArray(v) ? v : [v]).map((x) => String(x));
};

/* One question, as markup the browser already knows how to render. */
function renderQuestion(q, values, errors, layout) {
    const meta = typeOf(q.type);
    if (!meta) return '';
    const span = resolveSpan(q, layout);

    const id = escapeHtml(q.id);
    const label = escapeHtml(q.label || '');
    const help = q.help ? `<span class="help">${escapeHtml(q.help)}</span>` : '';
    const star = q.required ? '<span class="req">*</span>' : '';
    const req = q.required ? ' required' : '';
    const error = errors && errors[q.id];
    const width = ` q--${span}`;
    const mine = echoed(values, q.id);
    const one = escapeHtml(mine[0] || '');
    const options = Array.isArray(q.options) ? q.options : [];

    if (meta.widget === 'info') {
        return `<div class="q${width}"><span class="qlabel">${label}</span>`
            + `${q.help ? `<div class="info">${escapeHtml(q.help)}</div>` : ''}</div>`;
    }

    let field;
    switch (meta.widget) {
        case 'textarea':
            field = `<textarea id="${id}" name="${id}" placeholder="Enter text"${req}>${one}</textarea>`;
            break;
        case 'select':
            field = `<select id="${id}" name="${id}"${req}><option value="">Select option...</option>`
                + options.map((o) => {
                    const v = escapeHtml(o.label);
                    return `<option value="${v}"${mine[0] === o.label ? ' selected' : ''}>${v}</option>`;
                }).join('')
                + '</select>';
            break;
        case 'radio':
            field = `<div class="choices">${options.map((o, i) => {
                const v = escapeHtml(o.label);
                return `<label class="choice" for="${id}_${i}"><input type="radio" id="${id}_${i}" name="${id}"`
                    + ` value="${v}"${mine[0] === o.label ? ' checked' : ''}${req}><span>${v}</span></label>`;
            }).join('')}</div>`;
            break;
        case 'checkboxes':
            field = `<div class="choices">${options.map((o, i) => {
                const v = escapeHtml(o.label);
                return `<label class="choice" for="${id}_${i}"><input type="checkbox" id="${id}_${i}" name="${id}"`
                    + ` value="${v}"${mine.includes(o.label) ? ' checked' : ''}><span>${v}</span></label>`;
            }).join('')}</div>`;
            break;
        case 'rating': {
            const top = Number(q.max) || 5;
            let stars = '';
            for (let i = 1; i <= top; i += 1) {
                stars += `<input type="radio" id="${id}_${i}" name="${id}" value="${i}"`
                    + `${String(i) === mine[0] ? ' checked' : ''}>`
                    + `<label for="${id}_${i}" title="${i}">&#9733;</label>`;
            }
            field = `<div class="stars">${stars}</div>`;
            break;
        }
        case 'range':
            field = `<input id="${id}" name="${id}" type="range" min="0" max="100" step="5" value="${one || '0'}">`;
            break;
        case 'money':
            field = '<div class="money"><span class="sym">$</span>'
                + `<input id="${id}" name="${id}" type="number" step="0.01" value="${one}"${req}></div>`;
            break;
        case 'number':
            field = `<input id="${id}" name="${id}" type="number" step="any" value="${one}"${req}>`;
            break;
        case 'date':
            field = `<input id="${id}" name="${id}" type="date" value="${one}"${req}>`;
            break;
        case 'email':
            field = `<input id="${id}" name="${id}" type="email" placeholder="Enter email" value="${one}"${req}>`;
            break;
        case 'url':
            field = `<input id="${id}" name="${id}" type="url" placeholder="https://" value="${one}"${req}>`;
            break;
        case 'tel':
            field = `<input id="${id}" name="${id}" type="tel" placeholder="Enter phone" value="${one}"${req}>`;
            break;
        default:
            field = `<input id="${id}" name="${id}" type="text" placeholder="Enter text" maxlength="5000"`
                + ` value="${one}"${req}>`;
    }

    return `<div class="q${width}${error ? ' bad' : ''}">`
        + `<label for="${id}">${label}${star}${help}</label>${field}`
        + `${error ? `<span class="err-line">${ERROR_ICON}${escapeHtml(error)}</span>` : ''}</div>`;
}

/* The whole card: heading, an optional banner, and the questions. Used for the
 * first view, a rejected submission and the view after a successful one, so all
 * three cannot drift apart. */
function formBody(form, token, questions, opts) {
    const o = opts || {};
    const s = o.settings || normalizeSettings({});
    // Title and description are ruled off and aligned together: a centred title
    // above a left-aligned description of itself reads as a mistake.
    const head = `head head--${s.titleAlign}${s.titleDivider ? ' head--rule' : ''}`;
    let body = `<div class="${head}"><h1>${escapeHtml(form.title || 'Form')}</h1>`;
    if (form.description) body += `<p class="intro">${escapeHtml(form.description)}</p>`;
    body += '</div>';
    if (o.banner) body += o.banner;
    // novalidate: the page validates on the server and renders its own message
    // per field, which the native popup would otherwise pre-empt.
    body += `<form method="POST" action="/form/${escapeHtml(token)}" novalidate><div class="grid">`;
    body += questions.map((q) => renderQuestion(q, o.values, o.errors, s.layout)).join('');
    body += '</div>';
    // Only when no field could carry the message. Repeating "one or more fields
    // are required" under a column of per-field messages says nothing new.
    const fieldErrors = o.errors ? Object.keys(o.errors).length : 0;
    if (o.reason && !fieldErrors) body += `<div class="note err">${escapeHtml(o.reason)}</div>`;
    body += '<button type="submit">Submit</button></form>';
    if (o.again) body += `<a class="again" href="/form/${escapeHtml(token)}">Submit another response</a>`;
    return body;
}

/* GET /form/:token — the public form. */
exports.renderForm = async (req, res) => {
    try {
        const resolved = await resolveForm(req.params.token);
        if (!resolved) return gone(res);
        const form = liveForm(resolved.form);
        const settings = normalizeSettings(form.settings);
        // Reached by the redirect that follows a submission. A stray ?sent=1 on a
        // hand-typed url only shows a banner above an empty form, which is
        // harmless — nothing is recorded by rendering.
        const justSent = String(req.query.sent || '') === '1';
        return send(res, 200, form.title || 'Form',
            formBody(form, req.params.token, visibleQuestions(form), {
                banner: justSent ? sentBanner(form) : '',
                again: justSent && settings.showResubmit,
                settings,
            }), settings);
    } catch (error) {
        logger.error(`ERROR in render public form: ${error.message}`);
        return send(res, 500, 'Error', '<h1>Something went wrong.</h1>');
    }
};

/* POST /form/:token — a submission becomes a task. */
exports.submitForm = async (req, res) => {
    try {
        const resolved = await resolveForm(req.params.token);
        if (!resolved) return gone(res);
        const { companyId } = resolved;
        const form = liveForm(resolved.form);
        const settings = normalizeSettings(form.settings);
        const questions = visibleQuestions(form);

        const mapped = mapSubmission(form, req.body || {}, { requireTaskName: settings.createTask });
        if (!mapped.valid) {
            // Re-rendered rather than redirected, because the answers already typed
            // have to survive, and a redirect could only carry them in the url —
            // where answers do not belong. Safe to re-send: a rejected submission
            // stores nothing, so repeating it cannot duplicate anything.
            return send(res, 200, form.title || 'Form', formBody(form, req.params.token, questions, {
                reason: mapped.reason,
                errors: mapped.errors,
                values: req.body || {},
                settings,
            }), settings);
        }

        // The submission is the record, so it is stored whether or not a task is
        // wanted from it. Task creation is what became optional, not the response.
        const stored = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORM_SUBMISSIONS,
            data: {
                formId: form._id,
                ProjectID: form.ProjectID,
                CompanyId: form.CompanyId || String(companyId),
                answers: mapped.record || [],
                deletedStatusKey: 0,
            },
        }, 'save').catch((e) => {
            logger.error(`form submit: submission not stored (${e.message})`);
            return null;
        });

        if (!settings.createTask) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.FORMS,
                data: [{ _id: form._id }, { $inc: { submissionCount: 1 } }, {}],
            }, 'updateOne').catch(() => {});
            return redirectAfterSubmit(res, req.params.token);
        }

        const tmpl = (form.templateSnapshot && (form.templateSnapshot.toObject
            ? form.templateSnapshot.toObject() : form.templateSnapshot)) || {};
        const answerText = settings.answersInDescription
            ? buildDescription(mapped.transcript.filter((t) => !t.mapped), mapped.taskFields.rawDescription)
            : String(mapped.taskFields.rawDescription || '');
        const data = Object.assign({}, tmpl, {
            _id: new mongoose.Types.ObjectId(),
            TaskKey: '-',
            ProjectID: form.ProjectID,
            CompanyId: form.CompanyId || String(companyId),
            sprintId: form.sprintId,
            sprintArray: form.sprintArray || tmpl.sprintArray,
            deletedStatusKey: 0,
            startDate: new Date(),
        }, mapped.taskFields, {
            rawDescription: answerText,
            // The editor reads this one; rawDescription alone showed an empty
            // description on the task.
            descriptionBlock: buildDescriptionBlock(answerText),
        });

        const indexObj = {
            indexName: 'groupByStatusIndex',
            searchKey: 'statusKey',
            searchValue: String(data.statusKey || 1),
        };
        const result = await taskMongo.create({
            data,
            user: form.userSnapshot || { id: form.createdBy, Employee_Name: '', companyOwnerId: '' },
            projectData: form.projectSnapshot || { _id: form.ProjectID, CompanyId: form.CompanyId },
            indexObj,
        });
        if (!result || !result.status) {
            logger.error(`form submit: task not created (${result && result.message})`);
            return send(res, 200, form.title || 'Form',
                '<h1>Thanks</h1><div class="note err">We could not record that just now. Please try again shortly.</div>',
                settings);
        }

        // Counted after the task exists, so the number means submissions filed.
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS,
            data: [{ _id: form._id }, { $inc: { submissionCount: 1 } }, {}],
        }, 'updateOne').catch(() => {});

        // Linked back so the response table can show which task each answer made.
        if (stored && stored._id) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.FORM_SUBMISSIONS,
                data: [{ _id: stored._id }, {
                    $set: {
                        taskId: String((result.data && result.data._id) || data._id),
                        taskKey: String((result.data && result.data.TaskKey) || ''),
                    },
                }, {}],
            }, 'updateOne').catch(() => {});
        }

        // Redirected, not rendered: the empty form with its self-dismissing banner
        // is served by the GET that follows, so reloading it repeats nothing.
        return redirectAfterSubmit(res, req.params.token);
    } catch (error) {
        logger.error(`ERROR in submit public form: ${error.message}`);
        return send(res, 500, 'Error', '<h1>Something went wrong.</h1>');
    }
};
