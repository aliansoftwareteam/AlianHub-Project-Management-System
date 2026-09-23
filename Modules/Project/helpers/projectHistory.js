const { default: mongoose } = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ROLE_OWNER } = require('../../../Config/roleTypes');
const logger = require('../../../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { HandleHistory } = require('../../Tasks/helpers/helper');
const { HandleBothNotification } = require('../../Tasks/helpers/handleNotification');
const { shownDate } = require('../../Tasks/helpers/notificationTemplate');
const { employeeNameOf, escapeText } = require('../../Tasks/helpers/taskWriteFields');

/* The web app filed reopen, avatar, colour and sharing rows under the end-date key; they keep it so older rows and new ones read alike. */
const SETTINGS_KEY = 'Project_EndDate';

const HISTORY = Object.freeze({
    NAME: 'Project_Name',
    STATUS: 'Project_Status',
    ASSIGNEE_ADD: 'Project_Assignee_Add',
    ASSIGNEE_REMOVE: 'Project_Assignee_Removed',
    TYPE: 'Project_Type',
    CURRENCY: 'Project_Currency',
    DUE_DATE: 'Project_DueDate',
    START_DATE: 'Project_StartDate',
    END_DATE: 'Project_EndDate',
    SETTINGS: SETTINGS_KEY,
    WATCHERS: 'Project_Watchers',
    CREATED: 'Project_Created',
    SPRINT: 'Create_Sprint',
});

const NOTICE = Object.freeze({
    NAME: 'project_name',
    LIFECYCLE: 'project_close',
    STATUS: 'project_status_change',
    ASSIGNEE: 'project_assignee',
    TYPE: 'project_type',
    CURRENCY: 'project_currency',
    DUE_DATE: 'project_due_date',
    START_DATE: 'project_start_date',
    END_DATE: 'project_end_date',
    CREATED: 'project_create',
    SPRINT_CREATED: 'project_sprint_create',
    FOLDER_CREATED: 'project_folder_create',
});

/* Project_Name is left out: views and tags still post their own rows under it. Assignee_Changed is the key the project header used. */
const SERVER_BUILT_HISTORY = [
    HISTORY.STATUS, HISTORY.ASSIGNEE_ADD, HISTORY.ASSIGNEE_REMOVE, 'Assignee_Changed', HISTORY.TYPE, HISTORY.CURRENCY,
    HISTORY.DUE_DATE, HISTORY.START_DATE, HISTORY.END_DATE, HISTORY.WATCHERS, HISTORY.CREATED, HISTORY.SPRINT,
].map((key) => ({ type: 'project', key }));
const SERVER_BUILT_NOTIFICATIONS = Object.values(NOTICE);

const NOTICE_DATE_FORMAT = 'DD MMM, YYYY';
const DEFAULT_WATCH = 'participating_mentions';
const WATCH_LABELS = { all_activity: 'All Activity', participating_mentions: 'Participating and @mentions' };
const LIFECYCLE_VERBS = { 0: 'restored', 1: 'deleted', 2: 'archived' };

const has = (object, field) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, field);
const idOf = (value) => String(value && typeof value === 'object' ? (value._id || value.id || '') : value);
const instantOf = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const millis = new Date(value).getTime();
    return Number.isNaN(millis) ? null : millis;
};
const datePill = (date) => `<strong><span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">${date}</span></strong>`;

const lifecycle = ({ A, P }, verb) => ({
    history: { key: HISTORY.NAME, message: `<b>${A}</b> has ${verb} the <b>${P}</b> Project` },
    notice: { key: NOTICE.LIFECYCLE, message: `<p><strong>${A}</strong> has ${verb} the <strong>${P}</strong> Project</p>` },
    ...(verb === 'closed' ? { changeType: 'project_close', changeData: { projectName: P, userName: A } } : {}),
});

const renamed = ({ A, P, set, previous }) => {
    if (!has(set, 'ProjectName') || String(set.ProjectName) === String(previous.ProjectName || '')) return [];
    const next = escapeText(set.ProjectName);
    return [{
        history: { key: HISTORY.NAME, message: `<b>${A}</b> has changed the name of <b>${P}</b> to <b>${next}</b>` },
        notice: { key: NOTICE.NAME, message: `<p>Project name is changed from <strong> ${P}</strong> to <strong> ${next} </strong>.</p>` },
        changeType: 'name',
        changeData: { TaskName: next, previousTaskName: P },
    }];
};

const trashedOrRestored = (ctx) => {
    const { set, previous } = ctx;
    if (!has(set, 'deletedStatusKey')) return [];
    const next = Number(set.deletedStatusKey);
    if (next === (Number(previous.deletedStatusKey) || 0) || !LIFECYCLE_VERBS[next]) return [];
    return [lifecycle(ctx, LIFECYCLE_VERBS[next])];
};

const statusOf = (previous, value) => (previous.projectStatusData || []).find((status) => status && status.value === value) || {};

/* A status template swap in the project settings rewrites the status list and status together; the web app never described that as a change. */
const statusChanged = (ctx) => {
    const { A, P, set, previous } = ctx;
    if (!has(set, 'status') || has(set, 'projectStatusData') || set.status === previous.status) return [];
    const next = statusOf(previous, set.status);
    const before = statusOf(previous, previous.status);
    const nextType = set.statusType || next.type;
    const closedBefore = previous.statusType === 'close';
    if (nextType === 'close' && !closedBefore) return [lifecycle(ctx, 'closed')];
    if (closedBefore && nextType !== 'close') {
        return [{ history: { key: HISTORY.SETTINGS, message: `<b>${A}</b> has reopened <b>${P}</b> Project.` } }];
    }
    const shown = {
        ProjectName: P,
        backColor: escapeText(before.backgroundColor),
        color: escapeText(before.textColor),
        statusName: escapeText(before.name),
        bgColor: escapeText(next.backgroundColor),
        textColor: escapeText(next.textColor),
        newStatusName: escapeText(next.name || set.status),
    };
    return [{
        history: { key: HISTORY.STATUS, message: `<b>${A}</b> has changed <b> Status</b> as <b>${shown.newStatusName}</b>.` },
        notice: { key: NOTICE.STATUS, message: `<p>Status of <strong>${P}</strong> is changed from <span style="background-color:${shown.backColor}; color:${shown.color};padding-right: 5px;padding-left: 5px;border-radius: 5px;font-weight: 500;">${shown.statusName}</span> to <span style="font-weight: 500;background-color:${shown.bgColor}; color:${shown.textColor};padding-right: 5px;padding-left: 5px;border-radius: 5px;">${shown.newStatusName}</span>.</p>` },
        changeType: 'status',
        changeData: shown,
    }];
};

const assigneeChanged = async ({ A, P, previous, updateObject, key, nameOf }) => {
    if (!['$addToSet', '$pull'].includes(key) || !has(updateObject, 'AssigneeUserId')) return [];
    const uid = idOf(updateObject.AssigneeUserId);
    const assigned = (previous.AssigneeUserId || []).map(idOf).includes(uid);
    const adding = key === '$addToSet';
    if (adding === assigned) return [];
    const U = escapeText(await nameOf(uid));
    return [{
        history: adding
            ? { key: HISTORY.ASSIGNEE_ADD, message: `<b>${A}</b> has added the <b>${U}</b> to <b>Assignee</b>.` }
            : { key: HISTORY.ASSIGNEE_REMOVE, message: `<b>${A}</b> has removed the <b>${U}</b> to <b>Assignee</b>.` },
        notice: {
            key: NOTICE.ASSIGNEE,
            message: adding ? `<p><strong>${P}</strong> project is Assigned to <strong>${U}</strong>.</p>` : `<p><strong>${U}</strong> is Removed from <strong>${P}</strong> project.</p>`,
        },
        mentionUserId: [uid],
        changeType: 'assignee',
        changeData: { projectName: P, Employee_Name: U, type: adding ? 'add' : 'remove', name: U },
    }];
};

const typeChanged = ({ A, P, set, previous }) => {
    if (!has(set, 'ProjectType') || set.ProjectType === previous.ProjectType) return [];
    const name = escapeText(set.ProjectType);
    const previousType = escapeText(previous.ProjectType);
    return [{
        history: { key: HISTORY.TYPE, message: `<b>${A}</b> has changed <b> Type</b> as <b>${name}</b>.` },
        notice: { key: NOTICE.TYPE, message: `<p>Project Type of <strong>${P}</strong> is changed from <strong>${previousType}</strong> to <strong>${name}</strong>.</p>` },
        changeType: 'project_type',
        changeData: { ProjectName: P, previousType, name },
    }];
};

const currencyChanged = ({ A, P, set, previous }) => {
    if (!has(set, 'ProjectCurrency')) return [];
    const next = set.ProjectCurrency || {};
    const before = previous.ProjectCurrency || {};
    if (next.code === before.code && next.name === before.name) return [];
    const name = escapeText(next.name);
    const ProjectCurrency = escapeText(before.name);
    return [{
        history: { key: HISTORY.CURRENCY, message: `<b>${A}</b> has changed <b> Currency</b> as <b>${name}</b>.` },
        notice: { key: NOTICE.CURRENCY, message: `<p>Project Currency of <strong>${P}</strong> is changed from <strong>${ProjectCurrency}</strong> to <strong>${name}</strong>.</p>` },
        changeType: 'currency',
        changeData: { ProjectName: P, ProjectCurrency, name },
    }];
};

const DATES = [
    { field: 'StartDate', label: 'Start Date', history: HISTORY.START_DATE, notice: NOTICE.START_DATE, changeType: 'start_date', shown: (previous, next) => (previous ? { formetedStartDate: previous, newDate: next } : { formetedStartDate: next }) },
    { field: 'EndDate', label: 'End Date', history: HISTORY.END_DATE, notice: NOTICE.END_DATE, changeType: 'end_date', shown: (previous, next) => (previous ? { formatedDate: previous, newDate: next } : { formatedDate: next }) },
    { field: 'DueDate', label: 'Due Date', history: HISTORY.DUE_DATE, notice: NOTICE.DUE_DATE, changeType: 'due_date', shown: (previous, next) => (previous ? { previousDate: previous, changedDate: next } : { changedDate: next }) },
];

const datesChanged = ({ A, P, set, previous, timeZone }) => DATES.flatMap((date) => {
    if (!has(set, date.field)) return [];
    const next = instantOf(set[date.field]);
    const before = instantOf(previous[date.field]);
    if (next === null || next === before) return [];
    const shownNext = shownDate(next, NOTICE_DATE_FORMAT, timeZone);
    const shownBefore = before === null ? '' : shownDate(before, NOTICE_DATE_FORMAT, timeZone);
    const message = shownBefore
        ? `<p>${date.label} of <strong>${P}</strong> project is changed from ${datePill(shownBefore)} to ${datePill(shownNext)}.</p>`
        : `<p>${date.label} of <strong>${P}</strong> project is added as ${datePill(shownNext)}.</p>`;
    return [{
        history: { key: date.history, message: `<b>${A}</b> has changed <b> ${date.label}</b> as <b>DATE_${next}</b>.` },
        notice: { key: date.notice, message },
        changeType: date.changeType,
        changeData: { ProjectName: P, ...date.shown(shownBefore, shownNext) },
    }];
});

const iconChanged = ({ A, set, previous }) => {
    if (!has(set, 'projectIcon')) return [];
    const next = set.projectIcon || {};
    const before = previous.projectIcon || {};
    if (next.type === before.type && next.data === before.data) return [];
    return [{ history: { key: HISTORY.SETTINGS, message: `<b>${A}</b> has changed <b> ${next.type === 'color' ? 'color' : 'avatar'} </b>.` } }];
};

const sharingChanged = ({ A, set, previous }) => {
    if (!has(set, 'isPrivateSpace') || Boolean(set.isPrivateSpace) === Boolean(previous.isPrivateSpace)) return [];
    return [{ history: { key: HISTORY.SETTINGS, message: `<b>${A}</b> has changed <b>Share with option</b> as <b>${set.isPrivateSpace ? 'private' : 'public'}</b>.` } }];
};

/* The watcher panel only lets people change their own mode; joining with the default mode was never recorded. */
const watchModeChanged = ({ A, set, previous, actor }) => {
    const field = `watchers.${actor.id}`;
    if (!has(set, field)) return [];
    const next = String(set[field]);
    if (next === String((previous.watchers && previous.watchers[actor.id]) || DEFAULT_WATCH)) return [];
    return [{ history: { key: HISTORY.WATCHERS, message: `<b>${A}</b> has watchers activity as a <b>${WATCH_LABELS[next] || 'Ignore'}</b>` } }];
};

const SET_CHANGES = [renamed, statusChanged, trashedOrRestored, typeChanged, currencyChanged, datesChanged, iconChanged, sharingChanged, watchModeChanged];

const describeProjectChanges = async ({ previous, updateObject, key, actor, nameOf = employeeNameOf, timeZone }) => {
    if (!previous || !updateObject || typeof updateObject !== 'object') return [];
    const ctx = { A: actor.Employee_Name, P: escapeText(previous.ProjectName), previous, updateObject, key, actor, nameOf, timeZone };
    if (!key || key === '$set') return SET_CHANGES.flatMap((change) => change({ ...ctx, set: updateObject }));
    return assigneeChanged(ctx);
};

const companyOwnerOf = async (companyId) => {
    const owner = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ roleType: ROLE_OWNER, isDelete: { $ne: true } }, { userId: 1 }],
    }, 'findOne').catch(() => null);
    return owner && owner.userId ? String(owner.userId) : '';
};

/* Project notifications copy in the company owner, so the owner is looked up rather than taken from the request. */
const projectActor = async (companyId, uid) => ({
    id: String(uid),
    Employee_Name: escapeText(await employeeNameOf(String(uid))),
    companyOwnerId: await companyOwnerOf(companyId),
});

const logFailure = (what) => (error) => logger.error(`${what}: ${(error && error.message) || JSON.stringify(error)}`);

const send = ({ companyId, projectId, actor, entries }) => Promise.all(entries.flatMap((entry) => [
    HandleHistory('project', companyId, String(projectId), null, entry.history, actor).catch(logFailure('project history')),
    entry.notice
        ? HandleBothNotification({
            type: 'project',
            companyId,
            projectId: String(projectId),
            object: entry.notice,
            userData: actor,
            changeType: entry.changeType || '',
            changeData: entry.changeData || {},
            mentionUserId: entry.mentionUserId || [],
        }).catch(logFailure('project notification'))
        : null,
]));

const recordProjectChanges = async ({ companyId, projectId, actorId, previous, updateObject, key, timeZone }) => {
    if (!previous) return;
    const actor = await projectActor(companyId, actorId);
    const entries = await describeProjectChanges({ previous, updateObject, key, actor, timeZone });
    if (entries.length) await send({ companyId, projectId, actor, entries });
};

const recordProjectCreated = async ({ companyId, project, actorId }) => {
    const actor = await projectActor(companyId, actorId);
    const P = escapeText(project.ProjectName);
    await send({
        companyId,
        projectId: project._id,
        actor,
        entries: [{
            history: { key: HISTORY.CREATED, message: `<b>${actor.Employee_Name}</b> has created new as <b>${P}</b> project` },
            notice: { key: NOTICE.CREATED, message: `<p>Created a new project named <strong>${P}</strong>.</p>` },
            changeType: 'project_create',
            changeData: { ProjectName: P },
        }],
    });
};

const projectNameOf = async (companyId, projectId) => {
    if (!/^[0-9a-f]{24}$/i.test(String(projectId))) return '';
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: new mongoose.Types.ObjectId(String(projectId)) }, { ProjectName: 1 }],
    }, 'findOne').catch(() => null);
    return (project && project.ProjectName) || '';
};

module.exports = {
    HISTORY,
    NOTICE,
    SERVER_BUILT_HISTORY,
    SERVER_BUILT_NOTIFICATIONS,
    describeProjectChanges,
    recordProjectChanges,
    recordProjectCreated,
    projectActor,
    projectNameOf,
    send,
};
