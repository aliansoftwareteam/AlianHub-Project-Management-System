/**
 * AI Project Generator — orchestrator.
 *
 * Phase A — major changes from the previous implementation:
 *
 *  1. NO folder layer. Plans go `project → sprints[] → tasks[]` matching
 *     the manual wizard's hierarchy.
 *
 *  2. Task descriptions land as Editor.js blocks in `descriptionBlock`
 *     (the same field manual tasks use). `rawDescription` is derived
 *     from the block text. `description` (HTML) is no longer written.
 *
 *  3. The LLM's chosen `priority` is wired through to `Task_Priority`.
 *     No more hardcoded `MEDIUM`.
 *
 *  4. The default task status keeps the name the LLM picked. No more
 *     "force-rename to 'To Do'". Domain-specific names survive intact.
 *
 *  5. Plan-limit gate matches the manual flow: `checkProjectPlan` runs
 *     before any work, with `removeProjectCount` rollback on failure.
 *
 *  6. `ProjectCode` is generated server-side from the project name using
 *     the same first-letter regex the manual wizard uses, with a
 *     suffix-on-collision retry against existing company project codes.
 *
 *  7. Required views default to ALL company `project_tab_components`
 *     (minus Gantt / Timeline which are always excluded). Apps default
 *     to ALL company apps. These match "company defaults" for both.
 *
 *  8. Every task's `watchers` array includes the creator's uid.
 *
 *  9. After project save, a `project_create` notification fires via
 *     `HandleBothNotification` — matching the manual flow's frontend
 *     `helper.js:44-54` call.
 */
'use strict';

const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections, settingsCollectionDocs } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const socketEmitter = require('../../event/socketEventEmitter');
const { addSprintFun } = require('../Sprints/controller');
const { HandleHistory } = require('../Tasks/helpers/helper');
const { HandleBothNotification } = require('../Tasks/helpers/handleNotification');
const { checkProjectPlan, removeProjectCount } = require('../createProject/controller');
const { estimateAndPersist: estimateTaskTimeWithAI } = require('../EstimatedTime/aiTaskEstimator');
const sseEmitter = require('./sseEmitter');

// Concurrency cap for fire-and-forget AI estimates after bulk task insert —
// keeps us well under the LLM provider's per-key rate limits when a single
// project generates dozens of tasks at once.
const ESTIMATE_CONCURRENCY = 3;

function fireTaskEstimatesInBackground(companyId, docs) {
    if (!Array.isArray(docs) || docs.length === 0) return;
    let cursor = 0;
    const runOne = async () => {
        while (cursor < docs.length) {
            const idx = cursor;
            cursor += 1;
            const d = docs[idx];
            try {
                await estimateTaskTimeWithAI({
                    companyId,
                    taskId: String(d._id),
                    task: d,
                });
            } catch (e) {
                logger.error(`AI task estimate error (orchestrator): ${e && e.message ? e.message : e}`);
            }
        }
    };
    const workers = Math.min(ESTIMATE_CONCURRENCY, docs.length);
    for (let i = 0; i < workers; i += 1) {
        runOne();
    }
}

// Hardcoded list of view columns that manual createProject also injects
// regardless of wizard input (see Modules/createProject/controller.js:440-487).
// We mirror it for parity so the project's list view looks identical
// whether it was bootstrapped manually or by AI.
const DEFAULT_VIEW_COLUMNS = [
    { label: 'Chat', key: 'commentCounts', postition: 0, show: true },
    { label: 'Assignee', key: 'AssigneeUserId', funcPermission: 'task.task_assignee', postition: 1, show: true },
    { label: 'Due Date', key: 'DueDate', funcPermission: 'task.task_due_date', postition: 2, show: true },
    { label: 'Priority', key: 'Task_Priority', funcPermission: 'task.task_priority', appPermission: 'Priority', postition: 3, show: true },
    { label: 'Key', key: 'TaskKey', postition: 4, show: true },
    { label: 'Created Date', key: 'created_date', postition: 5, show: true },
    { label: 'Created By', key: 'created_by', postition: 6, show: true },
];

// Curated palette of distinct, legible status colors. Each renders well
// over a 21%-alpha tint of itself. When the LLM picks white / skips a
// color we cycle through this deterministically by index so a project's
// statuses stay visually distinct.
const STATUS_PALETTE = [
    '#FF9600', '#6473E8', '#22C55E', '#EF4444', '#A855F7',
    '#0EA5E9', '#F97316', '#14B8A6', '#EC4899', '#475569',
];
const DEFAULT_STATUS_TEXT = STATUS_PALETTE[1];
const DEFAULT_STATUS_BG = `${DEFAULT_STATUS_TEXT}35`;

// System-wide excluded views — Gantt / Timeline are never enabled by default
// on any project (manual or AI), so we drop them when reading the company
// `project_tab_components` catalog.
const ALWAYS_EXCLUDED_VIEW_KEYS = new Set(['gantt', 'timeline']);

// View key that should be the project's default landing tab if present.
// Falls back to whatever is first if List isn't in the catalog.
const PREFERRED_DEFAULT_VIEW_KEY = new Set(['list', 'projectlistview']);

// Cap the per-project ProjectCode collision retry at a reasonable number.
// In practice this loop terminates in 1-3 iterations for any non-pathological
// company; the cap is purely to prevent an unbounded loop if the company has
// thousands of overlapping codes.
const PROJECT_CODE_MAX_RETRY = 50;

// Editor.js shape constants used by buildDescriptionBlock + blocksToText.
const EDITORJS_VERSION = '2.30.7';

// ─── Color helpers ─────────────────────────────────────────────────────

function isTooLight(hex) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luma > 0.88;
}

// Convention: every status bg is the textColor with a "35" alpha suffix
// (~21% opacity). Matches existing project docs in the DB.
function bgFromText(textColor) {
    if (typeof textColor !== 'string') return DEFAULT_STATUS_BG;
    let hex = textColor.trim();
    if (!hex.startsWith('#')) hex = `#${hex}`;
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
        if (isTooLight(six)) return null;
        return six;
    };
    const fromText = tryHex(entry.textColor || entry.color || entry.foregroundColor);
    if (fromText) return fromText;
    const fromBg = tryHex(entry.bgColor || entry.backgroundColor);
    if (fromBg) return fromBg;
    return STATUS_PALETTE[idx % STATUS_PALETTE.length];
}

// ─── Project icon ──────────────────────────────────────────────────────
//
// Manual flow stores `projectIcon` as `{ type: 'color' | 'image', data }`.
// The LLM emits a richer `{ emoji, backgroundColor }`; we collapse to the
// manual shape so the project list sidebar's colored-initial pill renders
// identically. The emoji is dropped at save time — the manual flow doesn't
// support emoji icons either (initials are used).

const FALLBACK_PROJECT_ICON_COLOR = '#6473E8';

function normalizeProjectIcon(raw) {
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

// ─── ProjectCode generation ────────────────────────────────────────────
//
// First-letter-of-each-word rule, matching the manual wizard at
// `frontend/src/components/templates/CreateProject/ProjectForm.vue:132-143`.
// Then check uniqueness against existing company project codes and append
// a numeric suffix if needed (PROJ → PROJ2 → PROJ3 → ...).

function deriveProjectCodeBase(projectName) {
    const name = String(projectName || '').trim();
    if (!name) return 'PRJ';
    const matches = name.match(/\b(\w)/g);
    if (!matches || !matches.length) return 'PRJ';
    let code = matches.join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return 'PRJ';
    // ProjectCode regex is 2-6 chars; clamp the head.
    code = code.slice(0, 6);
    if (code.length < 2) code = (code + 'X').slice(0, 6);
    return code;
}

async function generateUniqueProjectCode(companyId, projectName) {
    const base = deriveProjectCodeBase(projectName);
    // Pull existing codes once, then iterate in memory — cheaper than N round trips.
    const existing = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [
            { deletedStatusKey: 0 },
            { ProjectCode: 1, _id: 0 },
        ],
    }, 'find').catch(() => []);
    const taken = new Set((existing || []).map((p) => String(p.ProjectCode || '').toUpperCase()));
    if (!taken.has(base)) return base;
    for (let i = 2; i <= PROJECT_CODE_MAX_RETRY + 1; i += 1) {
        // Keep within the 6-char schema cap — drop chars from the base before
        // appending the suffix if necessary.
        const suffix = String(i);
        const maxBase = Math.max(2, 6 - suffix.length);
        const candidate = `${base.slice(0, maxBase)}${suffix}`;
        if (!taken.has(candidate)) return candidate;
    }
    // Pathological fallback: append a 4-char hex.
    return `${base.slice(0, 2)}${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
}

// ─── Dates ─────────────────────────────────────────────────────────────

function safeIsoDate(value) {
    if (!value) return null;
    try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        return d;
    } catch (_e) { return null; }
}

// ─── Company context loading ───────────────────────────────────────────

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

// ─── Status / task type merge with company SETTINGS ───────────────────
//
// Match AI-emitted entries to existing company settings by case-insensitive
// name. Matches reuse the existing key/colors (so a name the model coined
// that overlaps the company's catalog stays consistent across projects).
// New entries get incrementing keys starting from `totalStatus + 1` and
// are returned so the orchestrator can `$push` them back into SETTINGS
// after the project saves.

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

// ─── Required views — match company defaults ───────────────────────────

function pickRequiredComponents(tabComponents) {
    if (!Array.isArray(tabComponents) || !tabComponents.length) return [];
    let defaultPicked = false;
    const shaped = tabComponents
        .filter((v) => {
            const lowerName = String(v.name || '').toLowerCase();
            const lowerKey = String(v.keyName || '').toLowerCase();
            if (ALWAYS_EXCLUDED_VIEW_KEYS.has(lowerName) || ALWAYS_EXCLUDED_VIEW_KEYS.has(lowerKey)) return false;
            return true;
        })
        .map((v) => {
            const lowerName = String(v.name || '').toLowerCase();
            const lowerKey = String(v.keyName || '').toLowerCase();
            const isDefault = !defaultPicked && (PREFERRED_DEFAULT_VIEW_KEY.has(lowerName) || PREFERRED_DEFAULT_VIEW_KEY.has(lowerKey));
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
    if (!defaultPicked && shaped[0]) shaped[0].setAsDefault = true;
    return shaped;
}

// All available company apps default to enabled — matches manual wizard's
// pre-selection behavior and the user's "company defaults" decision.
function pickAppKeys(apps) {
    if (!Array.isArray(apps) || !apps.length) return [];
    const keys = [];
    for (const a of apps) {
        if (a && a.key) keys.push(a.key);
    }
    return keys;
}

// ─── Description block helpers ─────────────────────────────────────────

/**
 * Normalize a list block's items into the shape `@editorjs/nested-list`
 * expects: an array of `{ content, items: [] }` objects, NOT plain strings.
 * The LLM emits items as `["step 1", "step 2"]` (the natural shape and what
 * the prompt examples show) but the frontend editor reads `item.content`,
 * so plain strings render as the literal text "undefined". Convert here so
 * the prompts stay readable and the saved doc still renders correctly.
 */
function normalizeListItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((it) => {
        if (typeof it === 'string') return { content: it, items: [] };
        if (it && typeof it === 'object') {
            const content = typeof it.content === 'string'
                ? it.content
                : (typeof it.text === 'string' ? it.text : '');
            const nested = Array.isArray(it.items) ? normalizeListItems(it.items) : [];
            return { content, items: nested };
        }
        return { content: String(it == null ? '' : it), items: [] };
    });
}

/**
 * Wrap the LLM's `descriptionBlocks` array into the `descriptionBlock`
 * shape Editor.js expects on the saved task doc.
 */
function wrapDescriptionBlock(blocks) {
    const normalized = Array.isArray(blocks) ? blocks.map((b) => {
        if (b && b.type === 'list' && b.data) {
            return { ...b, data: { ...b.data, items: normalizeListItems(b.data.items) } };
        }
        return b;
    }) : [];
    return {
        time: Date.now(),
        version: EDITORJS_VERSION,
        blocks: normalized,
    };
}

/**
 * Plain-text extraction from Editor.js blocks. Mirrors the manual flow's
 * `blocksToText` (frontend/src/components/atom/Description/Description.vue:281)
 * — paragraph + header text plus list items joined by newlines. Used to
 * populate `rawDescription` so search and previews work identically.
 */
function blocksToText(blocks) {
    if (!Array.isArray(blocks)) return '';
    const lines = [];
    for (const b of blocks) {
        if (!b || !b.data) continue;
        if (b.type === 'paragraph' && typeof b.data.text === 'string') {
            lines.push(b.data.text);
        } else if (b.type === 'header' && typeof b.data.text === 'string') {
            lines.push(b.data.text);
        } else if (b.type === 'list' && Array.isArray(b.data.items)) {
            for (const item of b.data.items) {
                if (typeof item === 'string') lines.push(item);
                else if (item && typeof item === 'object' && typeof item.content === 'string') lines.push(item.content);
            }
        }
    }
    return lines.join('\n').trim();
}

// ─── Project doc builder ───────────────────────────────────────────────

function buildProjectDoc({ plan, context, companyId, uid, projectIdHint, projectCode }) {
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

    // Ensure exactly one default_active. The schema validates this on the
    // LLM's output but the merge step picks up `type` from existing settings
    // which may not have one — guard regardless.
    const ensureDefaultActive = (list) => {
        if (!list.length) return list;
        if (!list.some((x) => x.type === 'default_active')) list[0].type = 'default_active';
        return list;
    };
    ensureDefaultActive(projectStatusMerge.merged);
    ensureDefaultActive(taskStatusMerge.merged);

    const defaultProjectStatus = projectStatusMerge.merged.find((s) => s.type === 'default_active') || projectStatusMerge.merged[0];
    const apps = pickAppKeys(context.apps);
    const projectRequired = pickRequiredComponents(context.tabComponents);
    const defaultComponent = projectRequired.find((c) => c.setAsDefault) || projectRequired[0] || {};
    const defaultRequired = defaultComponent.keyName || defaultComponent.name || '';

    const leadIds = Array.isArray(proj.LeadUserId) ? proj.LeadUserId : [];
    // AssigneeUserId on the project = creator + leads (union). Mirrors
    // manual wizard's behavior at CreateProjectSidebar.vue:675.
    const assignees = Array.from(new Set([String(uid || ''), ...leadIds].filter(Boolean)));

    const projectDoc = {
        _id: projectId,
        CompanyId: companyId,
        ProjectName: proj.ProjectName,
        ProjectCode: String(projectCode || '').toUpperCase(),
        ProjectCurrency: { code: 'USD', symbol: '$' },
        ProjectType: 'Fix',
        ProjectRequiredComponent: projectRequired,
        ProjectRequiredDefaultComponent: defaultRequired,
        LeadUserId: leadIds,
        AssigneeUserId: assignees,
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
    return MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: projectDoc }, 'save');
}

// ─── Sprint creation ───────────────────────────────────────────────────

async function createSprint({ companyId, projectId, projectName, sprintName, userData }) {
    const fakeReq = {
        body: {
            companyId,
            projectId: String(projectId),
            sprintName,
            userData,
            projectName,
            // No folder layer in Phase A — sprints attach directly to the project.
            folder: undefined,
            mainChat: false,
            private: false,
            sendMessage: false,
            // Skip the plan-count gate; checkProjectPlan was already passed.
            isPreCompany: true,
        },
    };
    const result = await addSprintFun(fakeReq);
    if (!result || !result.data || !result.data._id) {
        throw new Error(`addSprintFun returned no data for sprint "${sprintName}"`);
    }
    return result.data;
}

// ─── Task doc builder ──────────────────────────────────────────────────

const PRIORITY_NORMALIZE = {
    low: 'LOW', medium: 'MEDIUM', high: 'HIGH', urgent: 'URGENT',
};

function normalizePriority(raw) {
    if (typeof raw !== 'string') return 'MEDIUM';
    const norm = PRIORITY_NORMALIZE[raw.toLowerCase().trim()];
    return norm || 'MEDIUM';
}

function buildTaskDoc({ task, projectDoc, sprintDoc, statusByName, taskTypeByKey, creatorUid }) {
    const id = new mongoose.Types.ObjectId();
    const taskType = taskTypeByKey.get(String(task.TaskTypeKey || '')) || projectDoc.taskTypeCounts[0];

    // AI-created tasks always start in the FIRST task status column — the
    // company's "starting" state (typically "To Do" or "Backlog"). We
    // deliberately ignore whatever status the LLM picked, because new tasks
    // should never begin life as "In Progress" / "In Review" / "Done", and
    // the first column is what the user sees first on the kanban board.
    // Schema validates `taskStatusData` is non-empty, but we defensively
    // fall back through default_active just in case.
    const statusDetails = projectDoc.taskStatusData[0]
        || projectDoc.taskStatusData.find((s) => s.type === 'default_active');
    // statusByName is intentionally unused for AI flow — keep the param for
    // signature compatibility with manual-creation callers.
    void statusByName;

    const taskLeader = (task.AssigneeUserId && task.AssigneeUserId[0])
        || (Array.isArray(projectDoc.LeadUserId) && projectDoc.LeadUserId[0])
        || String(creatorUid || '');

    const assignees = Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : [];
    // Watchers: assignees + creator, deduped. Matches manual flow at
    // CreateTask.vue:271 (`[...AssigneeUserId, currentUserId]`).
    const watchers = Array.from(new Set([...assignees, String(creatorUid || '')].filter(Boolean)));

    const blocks = Array.isArray(task.descriptionBlocks) ? task.descriptionBlocks : [];
    const descriptionBlock = wrapDescriptionBlock(blocks);
    const rawDescription = blocksToText(blocks);

    return {
        _id: id,
        TaskName: String(task.TaskName).trim().slice(0, 200),
        TaskKey: '-',
        AssigneeUserId: assignees,
        watchers,
        DueDate: safeIsoDate(task.DueDate),
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
        Task_Priority: normalizePriority(task.priority),
        deletedStatusKey: 0,
        sprintId: sprintDoc._id,
        sprintArray: {
            id: String(sprintDoc._id),
            name: sprintDoc.name,
            value: String(sprintDoc.name || '').toUpperCase().replace(/\s+/g, '_'),
        },
        // Editor.js JSON for the rich-text renderer; rawDescription for
        // search/previews. Mirrors how manual tasks store descriptions.
        descriptionBlock,
        rawDescription,
        description: '',
        attachments: [],
        checklistArray: [],
        tagsArray: [],
        favouriteTasks: [],
        queueListArray: [],
        customField: {},
    };
}

async function reserveTaskKeyRange({ companyId, projectId, count, taskTypeIncrements }) {
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

async function createTasksForSprint({ companyId, projectDoc, sprintDoc, tasks, statusByName, taskTypeByKey, creatorUid }) {
    if (!tasks || tasks.length === 0) return [];

    const docs = tasks.map((t) => buildTaskDoc({
        task: t,
        projectDoc,
        sprintDoc,
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

    // MongoDbCrudOpration does model[method].apply(model, data.data). For
    // insertMany([t1, t2, t3]) we wrap the array so apply spreads it as
    // the single docs argument, not as positional args.
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

    for (const d of docs) {
        try { socketEmitter.emit('insert', { type: 'insert', data: d, module: 'task' }); } catch (_e) { /* ignore */ }
    }

    // Estimates run in the background so the orchestrator's progress stream
    // is not blocked by the per-task LLM calls. Each estimate persists its
    // own `totalEstimatedTime` update and emits a follow-up socket event.
    fireTaskEstimatesInBackground(companyId, docs);

    return docs;
}

// ─── Rollback ──────────────────────────────────────────────────────────

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
        if (tracker.project) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [{ _id: new mongoose.Types.ObjectId(tracker.project) }, { $set: { deletedStatusKey: 1 } }],
            }, 'updateOne').catch(() => {});
        }
        // Always roll back the project count if checkProjectPlan incremented
        // it — independent of whether the project doc was actually saved.
        // Previously this was tied to `tracker.project`, so a hang anywhere
        // between checkProjectPlan and saveProject would leak +1 on the
        // company's projectCount each retry, eventually tripping the plan
        // limit even though no project was created.
        if (tracker.countIncremented) {
            try { removeProjectCount(companyId, tracker.isPrivateSpace); } catch (_e) {}
        }
    } catch (e) {
        logger.error(`AI project rollback error: ${e && e.message ? e.message : e}`);
    }
}

// ─── Notification ──────────────────────────────────────────────────────
//
// Manual flow fires history + notification from the frontend after the
// project save returns (helper.js:32-55). Since the AI flow runs entirely
// server-side, we call HandleHistory + HandleBothNotification directly.

async function fireProjectCreateNotification({ companyId, projectDoc, userData }) {
    const notificationObject = {
        message: `<p>Created a new project named <strong>${projectDoc.ProjectName}</strong>.</p>`,
        key: 'project_create',
        projectId: String(projectDoc._id),
    };
    return HandleBothNotification({
        type: 'project',
        companyId,
        projectId: String(projectDoc._id),
        object: notificationObject,
        userData,
        changeType: 'project_create',
        changeData: { ProjectName: projectDoc.ProjectName },
    });
}

// ─── Orchestrator entry ────────────────────────────────────────────────

// Race a promise against a timeout so a hung MongoDB call doesn't freeze
// the execute UI forever. 45 seconds is well beyond normal DB latency.
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Step timed out after ${ms}ms: ${label}`)), ms)
        ),
    ]);
}

async function executePlan({ plan, companyId, uid, userData, jobId }) {
    const tracker = {
        project: null,
        sprints: [],
        tasks: [],
        isPrivateSpace: !!plan.project.isPrivateSpace,
        countIncremented: false,
    };
    const emit = (payload) => sseEmitter.emit(jobId, payload);

    try {
        // 1. Plan-limit gate — INTENTIONALLY BYPASSED.
        //
        // We still call `checkProjectPlan` because internally it $inc's the
        // company's `projectCount.{projectCount,publicCount,privateCount}`
        // counters BEFORE checking the limit ceiling. Keeping that call
        // means AI-created projects stay accurately counted in the
        // companies doc — matching how the manual createProject flow
        // tracks them. We just swallow the rejection that comes back
        // when the ceiling is tripped, so creation proceeds anyway.
        //
        // checkProjectPlan rejects in two distinct cases:
        //   (a) `countRollBack === false` — the $inc itself failed (e.g.
        //       Mongo write error). Count was NOT mutated, so we leave
        //       tracker.countIncremented = false. Nothing for the
        //       downstream rollback path to undo.
        //   (b) Otherwise — the $inc succeeded and only the ceiling
        //       check failed. Count WAS mutated, so we mark
        //       countIncremented = true and the existing rollback() in
        //       the outer catch will correctly decrement on later
        //       failure, exactly like the limit-not-tripped path.
        emit({ event: 'progress', step: 'project', status: 'started' });
        logger.info(`[AIPG][${jobId}] step 1: checkProjectPlan start (company=${companyId})`);
        try {
            await withTimeout(
                checkProjectPlan({ body: { CompanyId: companyId, isPrivateSpace: tracker.isPrivateSpace } }),
                45000, 'checkProjectPlan'
            );
            tracker.countIncremented = true;
        } catch (err) {
            const incrementFailed = err && err.countRollBack === false;
            if (!incrementFailed) {
                tracker.countIncremented = true;
            }
            const reason = (err && err.statusText)
                || (err && err.message)
                || 'unknown';
            logger.warn(`[AIPG][${jobId}] checkProjectPlan rejected — bypassed (reason: ${reason}, incrementApplied: ${!incrementFailed})`);
        }
        logger.info(`[AIPG][${jobId}] step 1: checkProjectPlan done (limit gate bypassed)`);

        // 2. Load company context.
        logger.info(`[AIPG][${jobId}] step 2: loadCompanyContext start`);
        const context = await withTimeout(loadCompanyContext(companyId), 45000, 'loadCompanyContext');
        logger.info(`[AIPG][${jobId}] step 2: loadCompanyContext done`);

        // 3. Server-side ProjectCode generation with collision retry.
        logger.info(`[AIPG][${jobId}] step 3: generateUniqueProjectCode start`);
        const projectCode = await withTimeout(
            generateUniqueProjectCode(companyId, plan.project.ProjectName),
            45000, 'generateUniqueProjectCode'
        );
        logger.info(`[AIPG][${jobId}] step 3: generateUniqueProjectCode done (code=${projectCode})`);

        // 4. Build project doc.
        const { projectDoc, statusUpdates } = buildProjectDoc({ plan, context, companyId, uid, projectCode });
        tracker.projectName = projectDoc.ProjectName;
        logger.info(`[AIPG][${jobId}] step 4: buildProjectDoc done`);

        // 5. Save project.
        logger.info(`[AIPG][${jobId}] step 5: saveProject start`);
        const savedProject = await withTimeout(saveProject(companyId, projectDoc), 45000, 'saveProject');
        tracker.project = projectDoc._id.toString();
        try { socketEmitter.emit('insert', { type: 'insert', data: savedProject || projectDoc, module: 'projects' }); } catch (_e) { /* ignore */ }
        emit({ event: 'progress', step: 'project', status: 'done', projectId: tracker.project });
        logger.info(`[AIPG][${jobId}] step 5: saveProject done (projectId=${tracker.project})`);

        // 6. $push new statuses/types into company SETTINGS (best-effort).
        await pushNewStatusesToSettings({ companyId, statusUpdates });

        // 7. Sprints (sequential).
        emit({ event: 'progress', step: 'sprint', status: 'started', total: plan.sprints.length });
        const sprintRecords = [];
        for (const sprint of plan.sprints) {
            emit({ event: 'progress', step: 'sprint', status: 'progress', name: sprint.sprintName });
            const sprintDoc = await createSprint({
                companyId,
                projectId: projectDoc._id,
                projectName: projectDoc.ProjectName,
                sprintName: sprint.sprintName,
                userData,
            });
            tracker.sprints.push({ id: sprintDoc._id.toString(), name: sprint.sprintName });
            sprintRecords.push({ sprint, sprintDoc });
        }
        emit({ event: 'progress', step: 'sprint', status: 'done', completed: tracker.sprints.length });

        // 8. Tasks (bulk per sprint).
        const totalTasks = plan.sprints.reduce((acc, s) => acc + (s.tasks || []).length, 0);
        let completed = 0;
        emit({ event: 'progress', step: 'tasks', status: 'started', total: totalTasks });

        const taskStatusByName = new Map(projectDoc.taskStatusData.map((s) => [s.name.toLowerCase(), { name: s.name, key: s.key, type: s.type }]));
        const taskTypeByKey = new Map(projectDoc.taskTypeCounts.map((t) => [String(t.key), t]));

        for (const { sprint, sprintDoc } of sprintRecords) {
            const created = await createTasksForSprint({
                companyId,
                projectDoc,
                sprintDoc,
                tasks: sprint.tasks || [],
                statusByName: taskStatusByName,
                taskTypeByKey,
                creatorUid: uid,
            });
            for (const t of created) tracker.tasks.push(t._id.toString());
            completed += created.length;
            emit({ event: 'progress', step: 'tasks', status: 'progress', completed, total: totalTasks });
        }

        // 9. History row (best-effort, single entry).
        const historyObject = {
            message: `<b>${userData.Employee_Name || 'AI'}</b> created project <b>${projectDoc.ProjectName}</b> with <b>${tracker.sprints.length}</b> sprints and <b>${tracker.tasks.length}</b> tasks via AI.`,
            key: 'Project_Created_AI',
        };
        HandleHistory('project', companyId, projectDoc._id.toString(), null, historyObject, userData).catch((e) => {
            logger.error(`AI orchestrator history error: ${e && e.message ? e.message : e}`);
        });

        // 10. project_create notification — parity with manual flow's
        // frontend helper.js:44-54 call.
        fireProjectCreateNotification({ companyId, projectDoc, userData }).catch((e) => {
            logger.error(`AI orchestrator notification error: ${e && e.message ? e.message : e}`);
        });

        // 11. Cache busts (mirror createProject).
        try { removeCache('UserProjectData:', true); } catch (_e) { /* ignore */ }

        emit({
            event: 'complete',
            projectId: tracker.project,
            projectName: projectDoc.ProjectName,
            totals: { sprints: tracker.sprints.length, tasks: tracker.tasks.length },
        });

        return { ok: true, projectId: tracker.project, totals: { sprints: tracker.sprints.length, tasks: tracker.tasks.length } };
    } catch (error) {
        logger.error(`[AIPG][${jobId}] orchestrator catch: ${error && error.message ? error.message : error}${error && error.stack ? '\n' + error.stack : ''}`);
        await rollback({ companyId, tracker });
        emit({ event: 'error', error: error && error.message ? error.message : String(error), rolledBack: true, code: error && error.code });
        return { ok: false, error: error && error.message ? error.message : String(error) };
    }
}

/**
 * Mirror the orchestrator's color normalization on the LLM-returned plan
 * so the preview chips in the wizard match the saved project's colors
 * exactly. Called by controller before stashing the plan for /execute.
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
    // Exported for tests / debugging.
    buildProjectDoc,
    mergeStatusList,
    rollback,
    bgFromText,
    pickTextColor,
    deriveProjectCodeBase,
    blocksToText,
    wrapDescriptionBlock,
    normalizePriority,
};
