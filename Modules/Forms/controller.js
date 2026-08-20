const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { generateShareToken } = require('../PublicShares/helpers/shareRules');
const { menu, TYPES, TASK_PROPERTIES, SPANS, GRID_COLUMNS, resolveSpan } = require('./helpers/questionTypes');
const {
    PRIORITIES,
    MAX_DESCRIPTION_LENGTH,
    MAX_SUCCESS_LENGTH,
    MAX_TITLE_LENGTH,
    isObjectIdString,
    validateFormInput,
    normalizeQuestions,
    validateStateChange,
    hydrateStored,
    hasTaskName,
    NO_TASK_NAME,
    normalizeDefaults,
    normalizeSettings,
} = require('./helpers/formRules');

// Forms — a project builds a form, and every submission is recorded as a row the
// form's own response table reads.
//
// Filing a task from each submission is OPTIONAL: when it is on, a question can
// be mapped to a task field, which is what makes an answer land in the task's due
// date rather than sitting in the description as text, and the answers arrive in
// the chosen sprint. When it is off the form only collects responses, and neither
// a sprint nor a task-name question is required.

/* Who is acting, from the JWT — never from the request body, which the caller
 * chooses. */
const callerId = (req) => String((req && req.uid) || '');

const mask = (d) => ({
    _id: d._id,
    title: d.title || '',
    description: d.description || '',
    ProjectID: d.ProjectID,
    sprintId: d.sprintId || null,
    // Widths are resolved here so the builder receives a concrete span for every
    // question and needs no copy of the fallback rule.
    questions: (Array.isArray(d.questions) ? d.questions : []).map((q) => {
        const plain = (q && q.toObject) ? q.toObject() : q;
        return { ...plain, span: resolveSpan(plain, (d.settings || {}).layout) };
    }),
    defaults: d.defaults || {},
    settings: d.settings || {},
    successMessage: d.successMessage || '',
    state: d.state || 'draft',
    submissionCount: d.submissionCount || 0,
    createdBy: d.createdBy || '',
    updatedBy: d.updatedBy || '',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
});

const publicBase = () => String(process.env.WEBURL || process.env.APIURL || '').replace(/\/+$/, '');

/**
 * Freeze what a submission needs into the form.
 *
 * The sprint is looked up on the PROJECT rather than trusted from the form: a
 * form pointing at a sprint in someone else's project would otherwise file its
 * submissions there. If the sprint is not one of this project's own, publishing
 * is refused rather than quietly retargeted.
 */
async function buildSnapshots(companyId, form, req) {
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: form.ProjectID, deletedStatusKey: { $ne: 1 } }],
    }, 'findOne');
    if (!project) return { ok: false, reason: 'Project not found.' };

    // Read the sprint from the sprints collection, not from anything embedded on
    // the project: a project document does not reliably carry sprintsObj (the ones
    // checked were empty), so scanning it rejected sprints that plainly exist.
    //
    // Naming the project in the FILTER is what keeps this a check rather than a
    // lookup — a sprint id from another project simply does not match, so a form
    // cannot be pointed at someone else's sprint. `projectId` is stored as a
    // string here, unlike ProjectID on the form.
    if (!form.sprintId) {
        return { ok: false, reason: 'Choose where submissions should go before publishing.' };
    }
    const sprint = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{
            _id: form.sprintId,
            projectId: String(form.ProjectID),
            deletedStatusKey: { $ne: 1 },
        }],
    }, 'findOne').catch(() => null);
    if (!sprint) {
        return { ok: false, reason: 'That sprint does not belong to this project. Pick one from this project.' };
    }
    const sprintArray = { id: String(sprint._id), name: sprint.name || 'Sprint' };
    if (sprint.folderId) {
        sprintArray.folderId = String(sprint.folderId);
        const folder = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FOLDERS, data: [{ _id: sprint.folderId }, 'name'],
        }, 'findOne').catch(() => null);
        sprintArray.folderName = (folder && folder.name) || '';
    }

    const defaults = form.defaults || {};
    const priority = PRIORITIES.includes(String(defaults.priority))
        ? String(defaults.priority) : 'MEDIUM';

    // Task type and status are per-project, so they cannot be hardcoded: a fixed
    // 'task'/1 matched no configured type and the task rendered with no type
    // icon. Honour the form's choice when it names a type the project really
    // has, otherwise fall back to the project's first.
    const projectTypes = (Array.isArray(project.taskTypeCounts) ? project.taskTypeCounts : [])
        .filter((t) => t && t.value !== undefined && t.key !== undefined);
    const chosenType = projectTypes.find((t) => String(t.key) === String(defaults.taskTypeKey))
        || projectTypes[0]
        || null;

    const projectStatuses = (Array.isArray(project.taskStatusData) ? project.taskStatusData : [])
        .filter((s) => s && s.key !== undefined);
    const openStatus = projectStatuses.find((s) => s.type === 'default_active')
        || projectStatuses[0]
        || { key: 1, name: 'To Do', type: 'default_active' };

    return {
        ok: true,
        set: {
            CompanyId: String(companyId),
            // ProjectCode is what taskMongo builds the task key from
            // (`${projectCode}-${n}`). Leaving it out produced keys like
            // "undefined-102" instead of "SSB-3".
            projectSnapshot: {
                _id: project._id,
                CompanyId: project.CompanyId || String(companyId),
                ProjectCode: project.ProjectCode,
                ProjectName: project.ProjectName,
            },
            sprintArray,
            // Whoever published owns the submissions: a public submitter has no
            // account, so the task needs a real member as its creator.
            userSnapshot: { id: callerId(req), Employee_Name: '', companyOwnerId: '' },
            templateSnapshot: {
                TaskName: '', TaskKey: '-', AssigneeUserId: [], watchers: [],
                DueDate: '', dueDateDeadLine: [],
                TaskType: chosenType ? chosenType.value : 'task',
                TaskTypeKey: chosenType ? Number(chosenType.key) : 1,
                ParentTaskId: '', ProjectID: project._id, CompanyId: project.CompanyId || String(companyId),
                status: { text: openStatus.name, key: Number(openStatus.key), type: openStatus.type },
                isParentTask: true,
                Task_Leader: callerId(req), Task_Priority: priority,
                deletedStatusKey: 0, statusType: openStatus.type, statusKey: Number(openStatus.key), points: null,
                rawDescription: '', descriptionBlock: {},
            },
        },
    };
}

/* One share row per form, reused across publish/unpublish so the url is stable. */
async function ensureFormShare(companyId, formId, userId) {
    try {
        const entityId = new mongoose.Types.ObjectId(formId);
        const existing = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PUBLIC_SHARES,
            data: [{ entityType: 'form', entityId }],
        }, 'findOne');
        if (existing) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PUBLIC_SHARES,
                data: [{ _id: existing._id }, { $set: { enabled: true } }, {}],
            }, 'updateOne');
            return { ok: true, token: existing.token };
        }
        const token = generateShareToken();
        const share = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PUBLIC_SHARES,
            data: { entityType: 'form', entityId, token, enabled: true, allowIntake: false, createdBy: userId },
        }, 'save');
        // The GLOBAL index is what lets an unauthenticated request find the tenant.
        await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.PUBLIC_SHARE_INDEX,
            data: { token, companyId: String(companyId), shareId: share._id },
        }, 'save');
        return { ok: true, token };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

/* The public url of an already-published form. Read from the share rather than
 * stored on the form, so there is one source of truth and nothing to drift; the
 * builder needs it on load, not just in the reply to Publish. */
async function publishedUrl(companyId, formId) {
    try {
        const share = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PUBLIC_SHARES,
            data: [{ entityType: 'form', entityId: new mongoose.Types.ObjectId(formId) }],
        }, 'findOne');
        if (!share || share.enabled === false || !share.token) return '';
        return `${publicBase()}/form/${share.token}`;
    } catch (e) {
        return '';
    }
}

/* GET /api/v2/forms/:id/submissions?page=&limit=&q=&all=
 *
 * The response table: one page at a time, optionally filtered.
 *
 * Columns are computed here rather than in the browser so a question deleted
 * after a submission still shows its answer. The form's current questions set the
 * order; anything answered but no longer asked is appended, and that extra set is
 * found with one aggregate over the whole form rather than from the rows on this
 * page — otherwise the columns would change as you paged. */
const SUBMISSIONS_PAGE_SIZE = 10;
const SUBMISSIONS_MAX_PAGE_SIZE = 100;
const SUBMISSIONS_EXPORT_CAP = 5000;

/* A search term goes into a regex, so its metacharacters have to stop being
 * metacharacters — otherwise a stray "(" is a 500 and ".*" scans everything. */
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.listSubmissions = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const id = String(req.params.id || '').trim();
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid form id are required.' });
        }
        const form = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS, data: [{ _id: id, deletedStatusKey: 0 }],
        }, 'findOne');
        if (!form) return res.send({ status: false, statusText: 'Form not found.' });

        const formId = new mongoose.Types.ObjectId(id);
        const term = String(req.query.q === undefined ? '' : req.query.q).trim().slice(0, 120);
        // The export takes every matching row, not the page on screen.
        const exportAll = String(req.query.all || '') === '1';
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = exportAll
            ? SUBMISSIONS_EXPORT_CAP
            : Math.min(SUBMISSIONS_MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || SUBMISSIONS_PAGE_SIZE));

        const filter = { formId, deletedStatusKey: 0 };
        // Matches any answer on the submission, so one box searches every column.
        if (term) filter['answers.value'] = { $regex: escapeRegex(term), $options: 'i' };

        const total = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORM_SUBMISSIONS, data: [filter],
        }, 'countDocuments').catch(() => 0);

        const pages = Math.max(1, Math.ceil((total || 0) / limit));
        const current = exportAll ? 1 : Math.min(page, pages);

        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORM_SUBMISSIONS,
            data: [filter, '', { sort: { createdAt: -1 }, skip: exportAll ? 0 : (current - 1) * limit, limit }],
        }, 'find').catch(() => []);

        const columns = [];
        const seen = new Set();
        for (const q of hydrateStored(form.questions)) {
            if (q.hidden) continue;
            columns.push({ id: q.id, label: q.label });
            seen.add(q.id);
        }
        const everAnswered = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORM_SUBMISSIONS,
            data: [[
                { $match: { formId, deletedStatusKey: 0 } },
                { $unwind: '$answers' },
                { $group: { _id: '$answers.questionId', label: { $first: '$answers.label' } } },
            ]],
        }, 'aggregate').catch(() => []);
        for (const extra of everAnswered || []) {
            if (extra && extra._id && !seen.has(extra._id)) {
                columns.push({ id: extra._id, label: extra.label || extra._id, gone: true });
                seen.add(extra._id);
            }
        }

        const data = (rows || []).map((row) => {
            const values = {};
            for (const a of (Array.isArray(row.answers) ? row.answers : [])) {
                if (a && a.questionId) values[a.questionId] = a.value === undefined ? '' : String(a.value);
            }
            return {
                _id: row._id,
                submittedAt: row.createdAt,
                taskKey: row.taskKey || '',
                taskId: row.taskId || '',
                values,
            };
        });

        return res.send({
            status: true,
            statusText: 'Submissions fetched.',
            data: {
                columns,
                submissions: data,
                total: total || 0,
                page: current,
                pages,
                limit,
                truncated: exportAll && (total || 0) > SUBMISSIONS_EXPORT_CAP,
            },
        });
    } catch (error) {
        logger.error(`ERROR in forms listSubmissions: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/forms/fields — the question catalogue for the builder's menu.
 *
 * Served rather than hard-coded in the browser so the menu and the validator can
 * never disagree about what exists or what a mapped question's type must be. */
exports.listBindableFields = async (req, res) => {
    try {
        return res.send({
            status: true,
            statusText: 'Fields fetched.',
            data: {
                groups: menu(),
                widgets: TYPES,
                spans: SPANS,
                gridColumns: GRID_COLUMNS,
                task: Object.keys(TASK_PROPERTIES).map((key) => ({ key, ...TASK_PROPERTIES[key] })),
            },
        });
    } catch (error) {
        logger.error(`ERROR in forms listBindableFields: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/forms?projectId=... — the forms in a project. */
exports.listForms = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const projectId = String(req.query.projectId || '').trim();
        if (!companyId || !isObjectIdString(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS,
            data: [
                { ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 },
                'title description sprintId state submissionCount createdBy updatedBy createdAt updatedAt',
                { sort: { createdAt: -1 } },
            ],
        }, 'find');
        return res.send({ status: true, statusText: 'Forms fetched.', data: (rows || []).map(mask) });
    } catch (error) {
        logger.error(`ERROR in forms listForms: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/forms/:id — one form, with its questions. */
exports.getForm = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const id = String(req.params.id || '').trim();
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid form id are required.' });
        }
        const form = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS,
            data: [{ _id: id, deletedStatusKey: 0 }],
        }, 'findOne');
        if (!form) return res.send({ status: false, statusText: 'Form not found.' });
        const data = mask(form);
        if (data.state === 'live') data.url = await publishedUrl(companyId, id);
        return res.send({ status: true, statusText: 'Form fetched.', data });
    } catch (error) {
        logger.error(`ERROR in forms getForm: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/forms  body: { title, projectId, description?, sprintId? } */
exports.createForm = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { title, projectId, description, sprintId } = req.body || {};
        const check = validateFormInput({ companyId, title, projectId });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });
        if (sprintId !== undefined && sprintId !== null && sprintId !== '' && !isObjectIdString(sprintId)) {
            return res.send({ status: false, statusText: 'sprintId must be a valid id when provided.' });
        }
        const userId = callerId(req);
        const doc = {
            title: String(title).trim().slice(0, MAX_TITLE_LENGTH),
            description: String(description || '').trim().slice(0, MAX_DESCRIPTION_LENGTH),
            ProjectID: new mongoose.Types.ObjectId(projectId),
            questions: [],
            defaults: {},
            settings: normalizeSettings({}),
            successMessage: '',
            // Always born a draft: a form with no questions has nothing to
            // submit, so it must not have a working public link yet.
            state: 'draft',
            submissionCount: 0,
            createdBy: userId,
            updatedBy: userId,
            deletedStatusKey: 0,
        };
        if (sprintId) doc.sprintId = new mongoose.Types.ObjectId(sprintId);

        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.FORMS, data: doc }, 'save');
        return res.send({ status: true, statusText: 'Form created.', data: mask(saved) });
    } catch (error) {
        logger.error(`ERROR in forms createForm: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/forms/:id  body: { title?, description?, sprintId?, questions?, defaults?, successMessage?, state? } */
exports.updateForm = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const id = String(req.params.id || '').trim();
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid form id are required.' });
        }
        const existing = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS,
            data: [{ _id: id, deletedStatusKey: 0 }],
        }, 'findOne');
        if (!existing) return res.send({ status: false, statusText: 'Form not found.' });

        const b = req.body || {};
        const set = { updatedBy: callerId(req) };

        if (b.title !== undefined) {
            const name = String(b.title).trim();
            if (!name || name.length > MAX_TITLE_LENGTH) {
                return res.send({ status: false, statusText: `A title up to ${MAX_TITLE_LENGTH} characters is required.` });
            }
            set.title = name;
        }
        if (b.description !== undefined) {
            set.description = String(b.description).trim().slice(0, MAX_DESCRIPTION_LENGTH);
        }
        if (b.successMessage !== undefined) {
            set.successMessage = String(b.successMessage).trim().slice(0, MAX_SUCCESS_LENGTH);
        }
        if (b.sprintId !== undefined) {
            if (b.sprintId === null || b.sprintId === '') {
                set.sprintId = null;
            } else if (!isObjectIdString(b.sprintId)) {
                return res.send({ status: false, statusText: 'sprintId must be a valid id.' });
            } else {
                set.sprintId = new mongoose.Types.ObjectId(b.sprintId);
            }
        }
        if (b.settings !== undefined) {
            set.settings = normalizeSettings(b.settings);
        }
        if (b.defaults !== undefined) {
            if (b.defaults === null || typeof b.defaults !== 'object' || Array.isArray(b.defaults)) {
                return res.send({ status: false, statusText: 'defaults must be an object.' });
            }
            set.defaults = normalizeDefaults(b.defaults);
        }
        if (b.questions !== undefined) {
            const norm = normalizeQuestions(b.questions);
            if (!norm.valid) return res.send({ status: false, statusText: norm.reason });
            const willCreateTask = normalizeSettings(
                b.settings !== undefined ? b.settings : existing.settings,
            ).createTask;
            if (existing.state === 'live' && willCreateTask
                && norm.questions.length && !hasTaskName(norm.questions)) {
                return res.send({ status: false, statusText: NO_TASK_NAME });
            }
            set.questions = norm.questions;
        }
        if (b.state !== undefined) {
            // Checked against what the form WILL be after this write, not what
            // it is now — otherwise adding questions and publishing in one call
            // would be judged against the empty version and refused.
            const nextQuestions = set.questions !== undefined ? set.questions : existing.questions;
            const nextSprint = set.sprintId !== undefined ? set.sprintId : existing.sprintId;
            const gate = validateStateChange({ state: b.state, questions: nextQuestions, sprintId: nextSprint });
            if (!gate.valid) return res.send({ status: false, statusText: gate.reason });
            set.state = String(b.state);
        }

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS,
            data: [{ _id: id }, { $set: set }, {}],
        }, 'updateOne');

        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS, data: [{ _id: id }],
        }, 'findOne');
        return res.send({ status: true, statusText: 'Form updated.', data: mask(updated) });
    } catch (error) {
        logger.error(`ERROR in forms updateForm: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/forms/:id/publish  body: { publish: true|false }
 *
 * Publishing does two things beyond flipping a flag.
 *
 * It SNAPSHOTS the project, sprint, task template and publishing user onto the
 * form. The public handler runs with no logged-in user and no company context,
 * so everything needed to build a task is frozen here rather than looked up per
 * submission — the same approach an email inbox takes.
 *
 * It then makes sure a public share row exists for the form. That is reused
 * rather than reinvented: the share carries the token, the GLOBAL token ->
 * company index the public request needs, and enable/disable and expiry for
 * free. */
exports.publishForm = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const id = String(req.params.id || '').trim();
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid form id are required.' });
        }
        const publish = (req.body || {}).publish !== false;

        const form = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS, data: [{ _id: id, deletedStatusKey: 0 }],
        }, 'findOne');
        if (!form) return res.send({ status: false, statusText: 'Form not found.' });

        if (!publish) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.FORMS,
                data: [{ _id: id }, { $set: { state: 'draft', updatedBy: callerId(req) } }, {}],
            }, 'updateOne');
            // The link stops working, but the row is kept: re-publishing keeps the
            // same url, so a link already handed out does not silently break.
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PUBLIC_SHARES,
                data: [{ entityType: 'form', entityId: new mongoose.Types.ObjectId(id) }, { $set: { enabled: false } }, {}],
            }, 'updateOne').catch(() => {});
            return res.send({ status: true, statusText: 'Form unpublished.', data: { state: 'draft', url: '' } });
        }

        const createTask = normalizeSettings(form.settings).createTask;
        const gate = validateStateChange({
            state: 'live', questions: form.questions, sprintId: form.sprintId, createTask,
        });
        if (!gate.valid) return res.send({ status: false, statusText: gate.reason });

        // The snapshot exists so an anonymous submission can build a task without
        // any auth context. A form that files no task needs none of it — only the
        // tenant, so its submissions can be stored.
        let set = { CompanyId: String(companyId) };
        if (createTask) {
            const snapshot = await buildSnapshots(companyId, form, req);
            if (!snapshot.ok) return res.send({ status: false, statusText: snapshot.reason });
            set = snapshot.set;
        }

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS,
            data: [{ _id: id }, { $set: { ...set, state: 'live', updatedBy: callerId(req) } }, {}],
        }, 'updateOne');

        const share = await ensureFormShare(companyId, id, callerId(req));
        if (!share.ok) return res.send({ status: false, statusText: share.reason });

        return res.send({
            status: true,
            statusText: 'Form published.',
            data: { state: 'live', token: share.token, url: `${publicBase()}/form/${share.token}` },
        });
    } catch (error) {
        logger.error(`ERROR in forms publishForm: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v2/forms/:id — soft delete.
 *
 * The tasks it already filed are left alone. They are ordinary tasks doing
 * ordinary work by now, and deleting a form is a statement about the form. */
exports.deleteForm = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const id = String(req.params.id || '').trim();
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid form id are required.' });
        }
        const form = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS, data: [{ _id: id, deletedStatusKey: 0 }],
        }, 'findOne');
        if (!form) return res.send({ status: false, statusText: 'Form not found.' });

        // Refused here, not only in the browser: a published form has a link in
        // circulation, and deleting it would turn that link into a 404 with no
        // way back. Unpublishing first is a deliberate, reversible step.
        if (form.state === 'live') {
            return res.send({
                status: false,
                statusText: 'This form is published. Unpublish it first, then delete it.',
            });
        }

        const r = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.FORMS,
            data: [{ _id: id, deletedStatusKey: 0 }, { $set: { deletedStatusKey: 1, updatedBy: callerId(req) } }, {}],
        }, 'updateOne');
        if (!r || !r.matchedCount) return res.send({ status: false, statusText: 'Form not found.' });
        return res.send({ status: true, statusText: 'Form deleted.' });
    } catch (error) {
        logger.error(`ERROR in forms deleteForm: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
