const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections, settingsCollectionDocs } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const socketEmitter = require('../../event/socketEventEmitter');
const { addSprintFun } = require('../Sprints/controller');
const { HandleHistory } = require('../Tasks/helpers/helper');
const { removeProjectCount } = require('../createProject/controller');
const { updateCompanyFun } = require('../Company/controller/updateCompany');
const sseEmitter = require('./sseEmitter');

const DEFAULT_VIEW_COLUMNS = [
    { label: 'Chat', key: 'commentCounts', postition: 0, show: true },
    { label: 'Assignee', key: 'AssigneeUserId', funcPermission: 'task.task_assignee', postition: 1, show: true },
    { label: 'Due Date', key: 'DueDate', funcPermission: 'task.task_due_date', postition: 2, show: true },
    { label: 'Priority', key: 'Task_Priority', funcPermission: 'task.task_priority', appPermission: 'Priority', postition: 3, show: true },
    { label: 'Key', key: 'TaskKey', postition: 4, show: true },
    { label: 'Created Date', key: 'created_date', postition: 5, show: true },
    { label: 'Created By', key: 'created_by', postition: 6, show: true },
];

// Curated palette of distinct, legible status colors. Each one renders well
// over a 21%-alpha tint of itself (our background convention), and none are
// white / near-white. When the LLM picks white or skips a color, we cycle
// through this palette deterministically by index so a project's statuses
// stay visually distinct.
const STATUS_PALETTE = [
    '#FF9600', // amber
    '#6473E8', // indigo
    '#22C55E', // emerald
    '#EF4444', // red
    '#A855F7', // violet
    '#0EA5E9', // sky
    '#F97316', // orange
    '#14B8A6', // teal
    '#EC4899', // pink
    '#475569', // slate
];

const DEFAULT_STATUS_TEXT = STATUS_PALETTE[1];
const DEFAULT_STATUS_BG = `${DEFAULT_STATUS_TEXT}35`;

// Treat near-white (lightness > ~88%) as "invalid" so we never emit white
// status text on a near-transparent white background.
function isTooLight(hex) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Perceived luminance (ITU-R BT.601).
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luma > 0.88;
}

// Convention: every status background is the textColor with an "35" alpha
// suffix (≈21% opacity). Existing project documents in the database use
// this pattern so the UI styling stays consistent.
function bgFromText(textColor) {
    if (typeof textColor !== 'string') return DEFAULT_STATUS_BG;
    let hex = textColor.trim();
    if (!hex.startsWith('#')) hex = `#${hex}`;
    // Allow 6 hex chars (#RRGGBB). If already 8 chars (with alpha), strip it.
    if (/^#[0-9A-Fa-f]{8}$/.test(hex)) hex = hex.slice(0, 7);
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return DEFAULT_STATUS_BG;
    return `${hex}35`;
}

function pickTextColor(entry, idx = 0) {
    const tryHex = (raw) => {
        if (typeof raw !== 'string') return null;
        const norm = raw.startsWith('#') ? raw : `#${raw}`;
        if (!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(norm)) return null;
        const six = norm.slice(0, 7);
        if (isTooLight(six)) return null;       // reject white / near-white
        return six;
    };
    const fromText = tryHex(entry.textColor || entry.color || entry.foregroundColor);
    if (fromText) return fromText;
    // Peel "35" alpha off a bg candidate if that's all we got.
    const fromBg = tryHex(entry.bgColor || entry.backgroundColor);
    if (fromBg) return fromBg;
    // Fall back to the palette so multiple statuses stay distinct.
    return STATUS_PALETTE[idx % STATUS_PALETTE.length];
}

// Project list sidebar (Item.vue) renders the project's color/initial pill from
// `projectIcon: { type: 'color', data: '#hex' }` — the same shape the manual
// create flow saves (see TemplateAllDetail.vue:136). The LLM emits a richer
// `{ emoji, backgroundColor }` we keep for preview, but the persisted document
// must use the manual shape so the list renders the colored initial box.
const FALLBACK_PROJECT_ICON_COLOR = '#6473E8';
function normalizeProjectIcon(raw) {
    // Manual flow already produces the canonical shape — pass through.
    if (raw && typeof raw === 'object' && (raw.type === 'color' || raw.type === 'image') && raw.data) {
        return { type: raw.type, data: String(raw.data) };
    }
    let color = FALLBACK_PROJECT_ICON_COLOR;
    if (raw && typeof raw === 'object') {
        const candidate = raw.backgroundColor || raw.bgColor || raw.color || raw.data;
        if (typeof candidate === 'string' && /^#?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(candidate.trim())) {
            const norm = candidate.trim().startsWith('#') ? candidate.trim() : `#${candidate.trim()}`;
            color = norm.slice(0, 7).toUpperCase();
        }
    }
    return { type: 'color', data: color };
}

function safeIsoDate(value) {
    if (!value) return null;
    try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        return d;
    } catch (_e) { return null; }
}

// Bump the company's projectCount.* counters but DO NOT enforce a plan limit.
// The AlianHub AI is intentionally exempt from the per-plan project quota —
// the existing `checkProjectPlan` (used by the manual flow) refused with
// "Plan limit check failed" once the company crossed `planFeature.project`,
// which blocked the AI feature in environments where the plan caps projects.
// We still increment the counters so other counter-driven features keep
// working; `removeProjectCount()` is called during rollback if the create
// fails partway.
async function incrementProjectCounters(companyId, isPrivateSpace) {
    const incFields = { 'projectCount.projectCount': 1 };
    incFields[isPrivateSpace ? 'projectCount.privateCount' : 'projectCount.publicCount'] = 1;
    const obj = {
        type: SCHEMA_TYPE.COMPANIES,
        data: [
            { _id: new mongoose.Types.ObjectId(companyId) },
            { $inc: incFields },
            { returnDocument: 'after' },
        ],
    };
    try {
        return await updateCompanyFun(SCHEMA_TYPE.GOLBAL, obj, 'findOneAndUpdate', companyId, true);
    } catch (e) {
        // Counter bump is best-effort; don't fail the whole bootstrap if Mongo hiccups.
        logger.error(`AIPG incrementProjectCounters error: ${e && e.message ? e.message : e}`);
        return null;
    }
}

async function loadCompanyContext(companyId) {
    const [projectStatusDoc, taskStatusDoc, taskTypeDoc, apps, tabComponents] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: dbCollections.SETTINGS, data: [{ name: settingsCollectionDocs.PROJECT_STATUS }] }, 'find'),
        MongoDbCrudOpration(companyId, { type: dbCollections.SETTINGS, data: [{ name: settingsCollectionDocs.TASK_STATUS }] }, 'find'),
        MongoDbCrudOpration(companyId, { type: dbCollections.SETTINGS, data: [{ name: settingsCollectionDocs.TASK_TYPE }] }, 'find'),
        MongoDbCrudOpration(companyId, { type: dbCollections.APPS, data: [{}] }, 'find'),
        MongoDbCrudOpration(companyId, { type: dbCollections.PROJECT_TAB_COMPONENTS, data: [{}] }, 'find'),
    ]);
    return {
        projectStatusSettings: (projectStatusDoc && projectStatusDoc[0]) || { settings: [], totalStatus: 0 },
        taskStatusSettings: (taskStatusDoc && taskStatusDoc[0]) || { settings: [], totalStatus: 0 },
        taskTypeSettings: (taskTypeDoc && taskTypeDoc[0]) || { settings: [], totalStatus: 0 },
        apps: apps || [],
        tabComponents: tabComponents || [],
    };
}

/**
 * Merge AI-generated entries with company SETTINGS by name (case-insensitive).
 * For matched entries, reuse existing key/colors. For new entries, generate
 * incrementing keys starting from settings.totalStatus + 1 and return them
 * so we can $push them to SETTINGS after the project save.
 *
 * @returns { merged: Array, newEntries: Array, finalTotal: number }
 */
function mergeStatusList({ planList, settings, shapeFn }) {
    const settingsList = Array.isArray(settings.settings) ? settings.settings : [];
    const byName = new Map(settingsList.map((s) => [String(s.name || '').toLowerCase(), s]));
    let total = Number(settings.totalStatus) || settingsList.length;
    const newEntries = [];
    const merged = (planList || []).map((item, idx) => {
        const name = String(item.name || '').trim();
        if (!name) return null;
        const existing = byName.get(name.toLowerCase());
        if (existing) {
            return shapeFn({ ...existing, ...item, name, key: existing.key, _matched: true }, idx);
        }
        total += 1;
        const created = shapeFn({ ...item, name, key: total, _matched: false }, idx);
        newEntries.push(created);
        return created;
    }).filter(Boolean);
    return { merged, newEntries, finalTotal: total };
}

function shapeProjectStatus(entry, idx) {
    const textColor = pickTextColor(entry, idx);
    return {
        key: entry.key,
        name: entry.name,
        value: entry.value || entry.name,
        backgroundColor: bgFromText(textColor),
        textColor,
        type: entry.type || (idx === 0 ? 'default_active' : 'active'),
    };
}

function shapeTaskStatus(entry, idx) {
    const textColor = pickTextColor(entry, idx);
    return {
        key: entry.key,
        name: entry.name,
        bgColor: bgFromText(textColor),
        textColor,
        type: entry.type || (idx === 0 ? 'default_active' : 'active'),
    };
}

function shapeTaskType(entry, idx) {
    return {
        key: entry.key,
        name: entry.name,
        value: entry.value || entry.name.toLowerCase().replace(/\s+/g, '_'),
        taskImage: entry.taskImage || 'task.png',
        _idx: idx,
    };
}

// AI-bootstrapped projects ship with EXACTLY these four views enabled:
// List (default landing), Project Details, Comments, Activity. Everything
// else (Board, Workload, Calendar, Table, Embed, etc.) is intentionally
// omitted from ProjectRequiredComponent so it doesn't clutter the project
// nav. Gantt and Timeline are ALWAYS excluded regardless — they're skipped
// system-wide.
const DEFAULT_ACTIVE_VIEWS = new Set([
    'list', 'projectlistview',
    'project details', 'projectdetail',
    'comments',
    'activity', 'activitylog',
]);
const ALWAYS_EXCLUDED_VIEWS = new Set([
    'gantt',
    'timeline',
]);
const DEFAULT_VIEW_NAME = new Set(['list', 'projectlistview']);

function pickRequiredComponents(tabComponents /* , requestedNames (ignored) */) {
    if (!Array.isArray(tabComponents) || !tabComponents.length) return [];
    let defaultPicked = false;
    const shaped = tabComponents
        .filter((v) => {
            const lowerName = String(v.name || '').toLowerCase();
            const lowerKey = String(v.keyName || '').toLowerCase();
            // Always drop Gantt/Timeline.
            if (ALWAYS_EXCLUDED_VIEWS.has(lowerName) || ALWAYS_EXCLUDED_VIEWS.has(lowerKey)) return false;
            // Keep only the 4 named views — everything else is omitted entirely
            // so the project nav stays clean. Users can re-enable additional
            // views from project settings if they need them.
            return DEFAULT_ACTIVE_VIEWS.has(lowerName) || DEFAULT_ACTIVE_VIEWS.has(lowerKey);
        })
        .map((v) => {
            const lowerName = String(v.name || '').toLowerCase();
            const lowerKey = String(v.keyName || '').toLowerCase();
            const isDefault = !defaultPicked && (DEFAULT_VIEW_NAME.has(lowerName) || DEFAULT_VIEW_NAME.has(lowerKey));
            if (isDefault) defaultPicked = true;
            return {
                _id: v._id ? new mongoose.Types.ObjectId(v._id) : new mongoose.Types.ObjectId(),
                activeIcon: v.activeIcon,
                icon: v.icon,
                createdAt: v.createdAt ? new Date(v.createdAt) : new Date(),
                keyName: v.keyName,
                name: v.name,
                value: v.value || v.keyName,
                updatedAt: v.updatedAt ? new Date(v.updatedAt) : new Date(),
                setAsDefault: isDefault,
                viewStatus: true,
            };
        });
    // Fall-back default if "List" wasn't in the company catalog: mark the
    // first kept view as default so the project has a landing tab.
    if (!defaultPicked && shaped[0]) shaped[0].setAsDefault = true;
    return shaped;
}

// Enable EVERY available app by default. The user can disable individual
// apps from project settings later.
function pickAppKeys(apps /* , requestedApps (ignored) */) {
    if (!Array.isArray(apps) || !apps.length) return [];
    const keys = [];
    for (const a of apps) {
        if (a && a.key) keys.push(a.key);
    }
    return keys;
}

function buildProjectDoc({ plan, context, companyId, uid, userData, projectIdHint }) {
    const projectId = projectIdHint
        ? new mongoose.Types.ObjectId(projectIdHint)
        : new mongoose.Types.ObjectId();

    const proj = plan.project;
    const projectStatusMerge = mergeStatusList({
        planList: proj.projectStatusData,
        settings: context.projectStatusSettings,
        shapeFn: shapeProjectStatus,
    });
    const taskStatusMerge = mergeStatusList({
        planList: proj.taskStatusData,
        settings: context.taskStatusSettings,
        shapeFn: shapeTaskStatus,
    });
    const taskTypeMerge = mergeStatusList({
        planList: proj.taskTypeCounts,
        settings: context.taskTypeSettings,
        shapeFn: shapeTaskType,
    });

    // Ensure exactly one default_active for projectStatusData and taskStatusData.
    const ensureDefaultActive = (list) => {
        if (!list.length) return list;
        const hasDefault = list.some((x) => x.type === 'default_active');
        if (!hasDefault) list[0].type = 'default_active';
        return list;
    };
    ensureDefaultActive(projectStatusMerge.merged);
    ensureDefaultActive(taskStatusMerge.merged);

    const defaultProjectStatus = projectStatusMerge.merged.find((s) => s.type === 'default_active') || projectStatusMerge.merged[0];
    const apps = pickAppKeys(context.apps);
    const projectRequired = pickRequiredComponents(context.tabComponents);
    // ProjectRequiredDefaultComponent stores the `keyName` (e.g. "ProjectListView"),
    // not the human-readable `name`. Existing project documents in the DB
    // confirm this — see Modules/createProject/controller.js where the same
    // value is assigned from tab metadata.
    const defaultComponent = projectRequired.find((c) => c.setAsDefault) || projectRequired[0] || {};
    const defaultRequired = defaultComponent.keyName || defaultComponent.name || '';

    const projectDoc = {
        _id: projectId,
        CompanyId: companyId,
        ProjectName: proj.ProjectName,
        ProjectCode: String(proj.ProjectCode || '').toUpperCase(),
        ProjectCurrency: { code: 'USD', symbol: '$' },
        ProjectType: proj.ProjectType || 'General',
        ProjectRequiredComponent: projectRequired,
        ProjectRequiredDefaultComponent: defaultRequired,
        LeadUserId: Array.isArray(proj.LeadUserId) ? proj.LeadUserId : [],
        AssigneeUserId: Array.isArray(proj.LeadUserId) ? proj.LeadUserId : [],
        // Per product convention, leave DueDate empty on AI-bootstrapped
        // projects — the user can set one explicitly afterwards.
        DueDate: '',
        description: proj.description || '',
        projectIcon: normalizeProjectIcon(proj.projectIcon),
        isPrivateSpace: !!proj.isPrivateSpace,
        isGlobalPermission: true,
        projectCreatedBy: String(uid || ''),
        projectStatusData: projectStatusMerge.merged,
        taskStatusData: taskStatusMerge.merged,
        taskTypeCounts: taskTypeMerge.merged.map((t) => { const { _idx, ...rest } = t; return rest; }),
        apps,
        status: defaultProjectStatus ? (defaultProjectStatus.value || defaultProjectStatus.name) : '',
        statusType: defaultProjectStatus ? defaultProjectStatus.type : 'active',
        viewColumn: DEFAULT_VIEW_COLUMNS,
        sprintsObj: {},
        sprintsfolders: {},
        lastTaskId: 0,
        deletedStatusKey: 0,
        attachments: [],
        checklistArray: [],
        dueDateDeadLine: [],
        milestoneAmount: 0,
        watchers: {},
        favouriteTasks: [],
        customField: {},
        tagsArray: [],
        descriptionBlock: {},
    };

    return {
        projectDoc,
        statusUpdates: {
            project: { newEntries: projectStatusMerge.newEntries, finalTotal: projectStatusMerge.finalTotal, didChange: projectStatusMerge.newEntries.length > 0 },
            task: { newEntries: taskStatusMerge.newEntries, finalTotal: taskStatusMerge.finalTotal, didChange: taskStatusMerge.newEntries.length > 0 },
            type: { newEntries: taskTypeMerge.newEntries.map((t) => { const { _idx, ...rest } = t; return rest; }), finalTotal: taskTypeMerge.finalTotal, didChange: taskTypeMerge.newEntries.length > 0 },
        },
    };
}

async function pushNewStatusesToSettings({ companyId, statusUpdates }) {
    const ops = [];
    if (statusUpdates.project.didChange) {
        ops.push(MongoDbCrudOpration(companyId, {
            type: dbCollections.SETTINGS,
            data: [
                { name: settingsCollectionDocs.PROJECT_STATUS },
                { $push: { settings: { $each: statusUpdates.project.newEntries } }, $set: { totalStatus: statusUpdates.project.finalTotal } },
            ],
        }, 'updateOne'));
    }
    if (statusUpdates.task.didChange) {
        ops.push(MongoDbCrudOpration(companyId, {
            type: dbCollections.SETTINGS,
            data: [
                { name: settingsCollectionDocs.TASK_STATUS },
                { $push: { settings: { $each: statusUpdates.task.newEntries } }, $set: { totalStatus: statusUpdates.task.finalTotal } },
            ],
        }, 'updateOne'));
    }
    if (statusUpdates.type.didChange) {
        ops.push(MongoDbCrudOpration(companyId, {
            type: dbCollections.SETTINGS,
            data: [
                { name: settingsCollectionDocs.TASK_TYPE },
                { $push: { settings: { $each: statusUpdates.type.newEntries } }, $set: { totalStatus: statusUpdates.type.finalTotal } },
            ],
        }, 'updateOne'));
    }
    await Promise.allSettled(ops);
}

async function saveProject(companyId, projectDoc) {
    const obj = { type: SCHEMA_TYPE.PROJECTS, data: projectDoc };
    return MongoDbCrudOpration(companyId, obj, 'save');
}

async function createFolder(companyId, projectId, folderName) {
    const updateObject = {
        name: folderName,
        projectId: new mongoose.Types.ObjectId(projectId),
        deletedStatusKey: 0,
    };
    const obj = { type: SCHEMA_TYPE.FOLDERS, data: updateObject };
    return MongoDbCrudOpration(companyId, obj, 'save');
}

async function createSprint({ companyId, projectId, projectName, sprintName, folder, userData }) {
    const fakeReq = {
        body: {
            companyId,
            projectId: String(projectId),
            sprintName,
            userData,
            projectName,
            folder: folder ? { folderId: String(folder._id), folderName: folder.name } : undefined,
            mainChat: false,
            private: false,
            sendMessage: false,
            isPreCompany: true, // skip the plan-count gate; we already passed checkProjectPlan
        },
    };
    const result = await addSprintFun(fakeReq);
    if (!result || !result.data || !result.data._id) {
        throw new Error(`addSprintFun returned no data for sprint "${sprintName}"`);
    }
    return result.data;
}

function markdownToHtml(md) {
    // Very small markdown→HTML helper. Good enough for the LLM's bullet
    // lists and "Acceptance criteria:" lines — the frontend's
    // `injectDescription()` then runs the same markdown renderer again,
    // which treats embedded HTML as pass-through.
    if (!md) return '';
    const lines = String(md).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let inList = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) {
            if (inList) { out.push('</ul>'); inList = false; }
            continue;
        }
        const bulletMatch = line.match(/^[-*]\s+(.*)$/);
        if (bulletMatch) {
            if (!inList) { out.push('<ul>'); inList = true; }
            out.push(`<li>${escapeHtml(bulletMatch[1])}</li>`);
            continue;
        }
        if (inList) { out.push('</ul>'); inList = false; }
        const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[1].length + 2; // ## → h4 (avoid huge titles)
            out.push(`<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`);
            continue;
        }
        out.push(`<p>${escapeHtml(line)}</p>`);
    }
    if (inList) out.push('</ul>');
    return out.join('');
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildTaskDoc({ task, projectDoc, sprintDoc, folderDoc, statusByName, taskTypeByKey, creatorUid }) {
    const id = new mongoose.Types.ObjectId();
    const taskType = taskTypeByKey.get(String(task.TaskTypeKey || '')) || projectDoc.taskTypeCounts[0];
    const statusName = (statusByName.get(String(task.status || '').toLowerCase())
        && statusByName.get(String(task.status || '').toLowerCase()).name)
        || (projectDoc.taskStatusData[0] && projectDoc.taskStatusData[0].name)
        || 'To Do';
    const statusDetails = projectDoc.taskStatusData.find((s) => s.name === statusName) || projectDoc.taskStatusData[0];
    // Task_Leader is required. Prefer first assignee → first project lead →
    // the user running the bootstrap.
    const taskLeader = (task.AssigneeUserId && task.AssigneeUserId[0])
        || (Array.isArray(projectDoc.LeadUserId) && projectDoc.LeadUserId[0])
        || String(creatorUid || '');
    const md = task.description || '';
    const rawDescription = String(md).replace(/[#*_`>]/g, '').replace(/\s+\n/g, '\n').trim();
    const html = markdownToHtml(md);

    return {
        _id: id,
        TaskName: String(task.TaskName).trim().slice(0, 200),
        TaskKey: '-',                 // filled after reserving lastTaskId range
        AssigneeUserId: Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : [],
        watchers: [],
        DueDate: null,                // empty by default — issue #4
        startDate: null,
        dueDateDeadLine: [],
        TaskType: taskType ? (taskType.value || taskType.name || 'task') : 'task',
        TaskTypeKey: taskType ? taskType.key : 0,
        ParentTaskId: '',
        ProjectID: projectDoc._id,
        CompanyId: projectDoc.CompanyId,
        status: {
            text: statusDetails.name,
            key: statusDetails.key,
            type: statusDetails.type,
        },
        statusType: statusDetails.type,
        statusKey: statusDetails.key,
        isParentTask: true,
        Task_Leader: taskLeader,
        Task_Priority: 'MEDIUM',       // issue #6 — uppercase default
        deletedStatusKey: 0,
        sprintId: sprintDoc._id,
        sprintArray: {
            id: String(sprintDoc._id),
            name: sprintDoc.name,
            value: String(sprintDoc.name || '').toUpperCase().replace(/\s+/g, '_'),
            ...(folderDoc ? { folderId: String(folderDoc._id), folderName: folderDoc.name } : {}),
        },
        ...(folderDoc ? { folderObjId: folderDoc._id } : {}),
        // description: HTML for the renderer, rawDescription: plain text for
        // search/previews. We deliberately omit `descriptionBlock` so the
        // frontend's markdown-fallback path is used.
        description: html,
        rawDescription,
        attachments: [],
        checklistArray: [],
        tagsArray: [],
        favouriteTasks: [],
        queueListArray: [],
        customField: {},
    };
}

async function reserveTaskKeyRange({ companyId, projectId, count, taskTypeIncrements }) {
    // Atomically bump lastTaskId by `count` and bump each taskType's taskCount.
    // Returns the new lastTaskId (after the increment) so keys range from
    // (newLast - count + 1) ... newLast.
    const incFields = { lastTaskId: count };
    for (const [k, v] of Object.entries(taskTypeIncrements)) {
        incFields[`taskTypeCounts.$[t${k}].taskCount`] = v;
    }
    const arrayFilters = Object.keys(taskTypeIncrements).map((k) => ({ [`t${k}.key`]: Number(k) }));
    const result = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [
            { _id: new mongoose.Types.ObjectId(projectId) },
            { $inc: incFields },
            { arrayFilters, returnDocument: 'after' },
        ],
    }, 'findOneAndUpdate');
    const lastTaskId = (result && result.lastTaskId) || count;
    return { newLastTaskId: lastTaskId, startKey: lastTaskId - count + 1 };
}

async function createTasksForSprint({ companyId, projectDoc, sprintDoc, folderDoc, tasks, statusByName, taskTypeByKey, creatorUid }) {
    if (!tasks || tasks.length === 0) return [];

    // Build the task docs first so we know the per-type counts.
    const docs = tasks.map((t) => buildTaskDoc({
        task: t,
        projectDoc,
        sprintDoc,
        folderDoc,
        statusByName,
        taskTypeByKey,
        creatorUid,
    }));
    const typeIncrements = {};
    for (const d of docs) {
        const k = String(d.TaskTypeKey);
        typeIncrements[k] = (typeIncrements[k] || 0) + 1;
    }
    const { startKey } = await reserveTaskKeyRange({
        companyId,
        projectId: projectDoc._id,
        count: docs.length,
        taskTypeIncrements: typeIncrements,
    });
    docs.forEach((d, i) => { d.TaskKey = `${projectDoc.ProjectCode}-${startKey + i}`; });

    // Insert all at once, then bump the sprint's task count.
    // MongoDbCrudOpration does `model[method].apply(model, data.data)` — so
    // for `insertMany([t1, t2, t3])` we must wrap the docs array in another
    // array, otherwise apply spreads each task as a positional argument and
    // Mongoose treats t1 as the doc, t2 as options, t3 as the callback —
    // resulting in only one task actually being inserted.
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [docs],
    }, 'insertMany');

    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [
            { _id: sprintDoc._id },
            { $inc: { tasks: docs.length } },
        ],
    }, 'updateOne').catch(() => {});

    // Emit one socket event per task so the existing taskSocket fan-out picks
    // them up for any user currently viewing the project/sprint.
    for (const d of docs) {
        try { socketEmitter.emit('insert', { type: 'insert', data: d, module: 'task' }); } catch (_e) { /* ignore */ }
    }
    return docs;
}

async function rollback({ companyId, tracker }) {
    try {
        if (tracker.tasks.length) {
            const taskIds = tracker.tasks.map((id) => new mongoose.Types.ObjectId(id));
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: { $in: taskIds } }, { $set: { deletedStatusKey: 1 } }],
            }, 'updateMany').catch(() => {});
        }
        if (tracker.sprints.length) {
            const sprintIds = tracker.sprints.map((s) => new mongoose.Types.ObjectId(s.id));
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.SPRINTS,
                data: [{ _id: { $in: sprintIds } }, { $set: { deletedStatusKey: 1 } }],
            }, 'updateMany').catch(() => {});
        }
        if (tracker.folders.length) {
            const folderIds = tracker.folders.map((f) => new mongoose.Types.ObjectId(f.id));
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.FOLDERS,
                data: [{ _id: { $in: folderIds } }, { $set: { deletedStatusKey: 1 } }],
            }, 'updateMany').catch(() => {});
        }
        if (tracker.project) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [{ _id: new mongoose.Types.ObjectId(tracker.project) }, { $set: { deletedStatusKey: 1 } }],
            }, 'updateOne').catch(() => {});
            // Decrement projectCount.* (best-effort).
            await removeProjectCount(companyId, tracker.isPrivateSpace).catch(() => {});
        }
    } catch (e) {
        logger.error(`AI project rollback error: ${e && e.message ? e.message : e}`);
    }
}

async function executePlan({ plan, companyId, uid, userData, jobId }) {
    const tracker = { project: null, folders: [], sprints: [], tasks: [], isPrivateSpace: !!plan.project.isPrivateSpace };
    const emit = (payload) => sseEmitter.emit(jobId, payload);

    try {
        // 1. Increment the company-level projectCount.* counters.
        // The AI flow intentionally skips the plan-limit gate that the
        // manual createProject flow runs (BUG-AIPG #1) — operators who
        // need to cap project counts on the AI path can re-introduce a
        // check here using `companies.planFeature.project`.
        emit({ event: 'progress', step: 'project', status: 'started' });
        await incrementProjectCounters(companyId, tracker.isPrivateSpace);

        // 2. Load company context.
        const context = await loadCompanyContext(companyId);

        // 3. Build project doc + collect status pushes.
        const { projectDoc, statusUpdates } = buildProjectDoc({ plan, context, companyId, uid, userData });
        tracker.projectName = projectDoc.ProjectName;

        // 4. Save project.
        const savedProject = await saveProject(companyId, projectDoc);
        tracker.project = projectDoc._id.toString();
        // Real-time fan-out so other connected clients pick up the new project
        // without a refresh (fixes the missing-emit gap flagged in the review).
        try { socketEmitter.emit('insert', { type: 'insert', data: savedProject || projectDoc, module: 'projects' }); } catch (_e) { /* ignore */ }
        emit({ event: 'progress', step: 'project', status: 'done', projectId: tracker.project });

        // 5. Push new statuses to SETTINGS (non-fatal).
        await pushNewStatusesToSettings({ companyId, statusUpdates });

        // 6. Folders → sprints (sequential per project).
        const sprintLookup = new Map(); // key: "folder|sprint" → sprintDoc
        for (const folder of plan.folders) {
            emit({ event: 'progress', step: 'folder', status: 'started', name: folder.folderName });
            const folderDoc = await createFolder(companyId, projectDoc._id, folder.folderName);
            tracker.folders.push({ id: folderDoc._id.toString(), name: folder.folderName });
            emit({ event: 'progress', step: 'folder', status: 'done', folderId: folderDoc._id.toString(), name: folder.folderName });

            for (const sprint of folder.sprints) {
                emit({ event: 'progress', step: 'sprint', status: 'started', name: sprint.sprintName, folder: folder.folderName });
                const sprintDoc = await createSprint({
                    companyId,
                    projectId: projectDoc._id,
                    projectName: projectDoc.ProjectName,
                    sprintName: sprint.sprintName,
                    folder: folderDoc,
                    userData,
                });
                tracker.sprints.push({ id: sprintDoc._id.toString(), name: sprint.sprintName, folderId: folderDoc._id.toString() });
                sprintLookup.set(`${folder.folderName}|${sprint.sprintName}`, { sprintDoc, folderDoc });
                emit({ event: 'progress', step: 'sprint', status: 'done', sprintId: sprintDoc._id.toString(), name: sprint.sprintName, folder: folder.folderName });
            }
        }

        // 7. Tasks — bulk per sprint.
        const totalTasks = plan.folders.reduce((acc, f) => acc + f.sprints.reduce((a, s) => a + s.tasks.length, 0), 0);
        let completed = 0;
        emit({ event: 'progress', step: 'tasks', status: 'started', total: totalTasks });

        const taskStatusByName = new Map(projectDoc.taskStatusData.map((s) => [s.name.toLowerCase(), { name: s.name, key: s.key, type: s.type }]));
        const taskTypeByKey = new Map(projectDoc.taskTypeCounts.map((t) => [String(t.key), t]));

        for (const folder of plan.folders) {
            for (const sprint of folder.sprints) {
                const entry = sprintLookup.get(`${folder.folderName}|${sprint.sprintName}`);
                if (!entry) continue;

                const created = await createTasksForSprint({
                    companyId,
                    projectDoc,
                    sprintDoc: entry.sprintDoc,
                    folderDoc: entry.folderDoc,
                    tasks: sprint.tasks || [],
                    statusByName: taskStatusByName,
                    taskTypeByKey,
                    creatorUid: uid,
                });
                for (const t of created) tracker.tasks.push(t._id.toString());
                completed += created.length;
                emit({ event: 'progress', step: 'tasks', status: 'progress', completed, total: totalTasks });
            }
        }

        // 8. History (best-effort, single entry).
        const historyObject = {
            message: `<b>${userData.Employee_Name || 'AI'}</b> created project <b>${projectDoc.ProjectName}</b> with <b>${tracker.folders.length}</b> folders, <b>${tracker.sprints.length}</b> sprints, and <b>${tracker.tasks.length}</b> tasks via AI.`,
            key: 'Project_Created_AI',
        };
        HandleHistory('project', companyId, projectDoc._id.toString(), null, historyObject, userData).catch((e) => {
            logger.error(`AI orchestrator history error: ${e && e.message ? e.message : e}`);
        });

        // 9. Cache busts (mirror createProject).
        try { removeCache('UserProjectData:', true); } catch (_e) { /* ignore */ }

        emit({
            event: 'complete',
            projectId: tracker.project,
            projectName: projectDoc.ProjectName,
            totals: { folders: tracker.folders.length, sprints: tracker.sprints.length, tasks: tracker.tasks.length },
        });

        return { ok: true, projectId: tracker.project, totals: { folders: tracker.folders.length, sprints: tracker.sprints.length, tasks: tracker.tasks.length } };
    } catch (error) {
        logger.error(`AI project orchestrator error: ${error && error.message ? error.message : error}`);
        await rollback({ companyId, tracker });
        emit({ event: 'error', error: error && error.message ? error.message : String(error), rolledBack: true });
        return { ok: false, error: error && error.message ? error.message : String(error) };
    }
}

/**
 * The entry/default task status is always renamed to "To Do" regardless of
 * what the LLM picked. Domain-specific names for the middle/terminal states
 * are kept (per the prompt), but the FIRST state stays universally "To Do"
 * so the project always opens with the same first-column label.
 *
 * If the LLM already emitted a non-default entry called "To Do" while
 * default_active was named "Backlog", the existing "To Do" gets a numeric
 * suffix to keep names unique.
 *
 * Mutates the plan in place AND returns it for fluent chaining.
 */
function forceDefaultStatusToDoName(plan) {
    if (!plan || !plan.project || !Array.isArray(plan.project.taskStatusData)) return plan;
    const TARGET = 'To Do';
    const statuses = plan.project.taskStatusData;
    const defaultIdx = statuses.findIndex((s) => s && s.type === 'default_active');
    if (defaultIdx < 0) return plan;
    const oldName = statuses[defaultIdx].name;
    if (oldName === TARGET) return plan;

    // If another status is already called "To Do", suffix it so we don't
    // create a duplicate name (which the validator already enforces uniqueness on).
    for (let i = 0; i < statuses.length; i++) {
        if (i !== defaultIdx && statuses[i].name === TARGET) {
            let suffix = 2;
            while (statuses.some((s, j) => j !== i && s.name === `${TARGET} ${suffix}`)) suffix += 1;
            statuses[i].name = `${TARGET} ${suffix}`;
        }
    }
    statuses[defaultIdx].name = TARGET;

    // Patch every task that referenced the old default-state name.
    if (Array.isArray(plan.folders)) {
        for (const folder of plan.folders) {
            if (!Array.isArray(folder.sprints)) continue;
            for (const sprint of folder.sprints) {
                if (!Array.isArray(sprint.tasks)) continue;
                for (const task of sprint.tasks) {
                    if (task && task.status === oldName) task.status = TARGET;
                }
            }
        }
    }
    return plan;
}

/**
 * Apply the same color normalization that the orchestrator uses at save time
 * to the LLM-returned plan, so the preview chips match the final saved
 * project exactly. The orchestrator's `shapeProjectStatus` / `shapeTaskStatus`
 * are the source of truth for what gets written; this helper mirrors them
 * for the preview path.
 */
function normalizePlanColors(plan) {
    if (!plan || !plan.project) return plan;
    const normalize = (entries, isProjectStatus) => {
        if (!Array.isArray(entries)) return entries;
        return entries.map((entry, idx) => {
            const textColor = pickTextColor(entry, idx);
            const bg = bgFromText(textColor);
            const next = { ...entry, textColor };
            if (isProjectStatus) next.backgroundColor = bg;
            else next.bgColor = bg;
            return next;
        });
    };
    plan.project.projectStatusData = normalize(plan.project.projectStatusData, true);
    plan.project.taskStatusData = normalize(plan.project.taskStatusData, false);
    return plan;
}

module.exports = {
    executePlan,
    normalizePlanColors,
    forceDefaultStatusToDoName,
    // exported for tests
    buildProjectDoc,
    mergeStatusList,
    rollback,
    bgFromText,
    pickTextColor,
};
