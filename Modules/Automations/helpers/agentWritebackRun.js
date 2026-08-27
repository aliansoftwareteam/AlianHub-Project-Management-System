'use strict';

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter');
const {
    gatherAutofillContext,
    previewAutofill,
    applyAutofillWrites,
} = require('../../Tasks/helpers/taskAiAutofillRun');
const { HandleHistory } = require('../../Tasks/helpers/mongo_helper');
const { ALIAN_MENTION_KEY } = require('../../Comments/helpers/alianMention');
const { idString } = require('../../Comments/helpers/commentThread');
const { citationsFromPack } = require('../../Pages/helpers/pageWorkspaceAsk');
const {
    isWritebackEnabled,
    eventGate,
    chooseWrite,
    planTaskAutofill,
    followupActivityMessage,
    heuristicPageBriefing,
    shapePageBriefing,
    listEmptyTargets,
    recordId,
} = require('./agentWriteback');

const inflight = new Set();
const OBJECT_ID = /^[a-f0-9]{24}$/i;

function asObjectId(id) {
    const raw = String(id || '').trim();
    if (!OBJECT_ID.test(raw)) return null;
    try {
        return new mongoose.Types.ObjectId(raw);
    } catch (_e) {
        return null;
    }
}

function lockKey(event) {
    return [event.companyId, event.type, event.taskId || event.pageId || ''].join(':');
}

async function loadProject(companyId, projectId) {
    const oid = asObjectId(projectId);
    if (!companyId || !oid) return null;
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: oid, deletedStatusKey: { $ne: 1 } }, 'ProjectName aiWritebackEnabled AssigneeUserId'],
    }, 'findOne').catch(() => null);
}

async function loadLinkedTasks(companyId, ids) {
    const objectIds = (ids || []).map(asObjectId).filter(Boolean);
    if (!companyId || !objectIds.length) return [];
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: objectIds }, deletedStatusKey: { $ne: 1 } }, 'TaskName TaskKey ProjectID'],
    }, 'find').catch(() => []);
    return rows || [];
}

async function postWritebackActivity({ companyId, task, message }) {
    const projectId = idString(task && task.ProjectID) || String((task && task.ProjectID) || '').trim();
    const taskId = recordId(task);
    if (!companyId || !projectId || !taskId || !message) return null;
    await HandleHistory('task', companyId, projectId, taskId, {
        key: 'agent_writeback',
        message,
        sprintId: (task && task.sprintId) || '',
    }, { id: ALIAN_MENTION_KEY, Employee_Name: 'Alian' });
    return { activity: true };
}

async function runTaskWriteback(event) {
    const context = await gatherAutofillContext({
        companyId: event.companyId,
        uid: event.uid,
        taskId: event.taskId,
    });
    const task = context && context.task;
    if (!task) {
        return { skipped: true, reason: (context && context.reason) || 'permission' };
    }
    const project = (context && context.project) || await loadProject(event.companyId, task.ProjectID);
    if (!isWritebackEnabled(project)) return { skipped: true, reason: 'disabled' };

    if (!context || context.allowed === false) {
        const message = followupActivityMessage({
            event,
            applied: [],
            statusText: event.statusText,
            commentExcerpt: event.comment && event.comment.message,
            taskTitle: task.TaskName || task.TaskKey,
        });
        await postWritebackActivity({
            companyId: event.companyId,
            task,
            message,
        });
        return { skipped: false, applied: [], action: 'activity', reason: context.reason };
    }

    const gated = eventGate({
        ...event,
        aiWritebackEnabled: true,
        permissions: context.permissions,
        comment: event.comment,
        taskId: recordId(context.task),
    });
    if (!gated.allowed) return { skipped: true, reason: gated.reason };

    const targets = listEmptyTargets({
        task: context.task,
        fields: context.fields,
        people: context.people,
        permissions: context.permissions,
    });
    const previewResult = await previewAutofill(context);
    const preview = (previewResult && previewResult.data) || { suggestions: [], skipped: [], targets: [] };
    const choice = chooseWrite({ event, emptyTargets: targets });
    if (choice.action === 'skip') return { skipped: true, reason: choice.reason };

    let applied = [];
    let skipped = preview.skipped || [];
    if (choice.action === 'autofill') {
        const planned = planTaskAutofill({
            incoming: preview.suggestions,
            targets,
            people: context.people,
            task: context.task,
        });
        skipped = [...skipped, ...planned.skipped];
        if (planned.suggestions.length) {
            const written = await applyAutofillWrites({
                companyId: context.companyId,
                task: context.task,
                suggestions: planned.suggestions,
            });
            applied = planned.suggestions.filter((row) => (
                (written.applied || []).some((item) => item.fieldId === row.fieldId)
            ));
            skipped = [...skipped, ...(written.skipped || [])];
        }
    }

    const message = followupActivityMessage({
        event,
        applied,
        statusText: event.statusText,
        commentExcerpt: event.comment && event.comment.message,
        taskTitle: context.task && (context.task.TaskName || context.task.TaskKey),
    });
    await postWritebackActivity({
        companyId: context.companyId,
        task: context.task,
        message,
    });
    return { skipped: false, applied, skipped, action: applied.length ? 'autofill' : 'activity' };
}

async function writePageBriefing(companyId, pageId, briefing) {
    const oid = asObjectId(pageId);
    if (!companyId || !oid || !briefing) return null;
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [
            { _id: oid, deletedStatusKey: 0 },
            { $set: { briefing } },
            { returnDocument: 'after' },
        ],
    }, 'findOneAndUpdate');
    if (updated) {
        try {
            socketEmitter.emit('update', { type: 'update', data: updated, module: 'pages' });
        } catch (error) {
            logger.error(`ERROR emitting page write-back: ${error.message}`);
        }
    }
    return updated;
}

async function runPageWriteback(event, page) {
    const projectId = page && page.ProjectID;
    const project = await loadProject(event.companyId, projectId);
    if (projectId && !isWritebackEnabled(project)) return { skipped: true, reason: 'disabled', page };
    if (!projectId && event.aiWritebackEnabled === false) return { skipped: true, reason: 'disabled', page };

    const gated = eventGate({
        ...event,
        pageId: recordId(page),
        aiWritebackEnabled: true,
    });
    if (!gated.allowed) return { skipped: true, reason: gated.reason, page };

    const linked = await loadLinkedTasks(event.companyId, page.linkedTasks);
    const rawText = String((page && page.rawText) || '').trim();
    const choice = chooseWrite({ event, pageText: rawText || (page && page.title) });
    if (choice.action !== 'briefing') return { skipped: true, reason: choice.reason, page };

    const heuristic = heuristicPageBriefing({
        title: page.title,
        rawText,
        linkedTasks: linked,
    });
    const packCitations = citationsFromPack({ pages: [page], tasks: linked });
    const shaped = shapePageBriefing({
        markdown: heuristic.markdown,
        packCitations,
        usedHints: heuristic.used,
        page,
    });
    if (!shaped.markdown) return { skipped: true, reason: 'empty-page', page };

    const briefing = {
        markdown: shaped.markdown,
        citations: shaped.citations,
        source: 'page_updated',
        updatedAt: new Date(),
    };
    const updated = await writePageBriefing(event.companyId, recordId(page), briefing);
    return { skipped: false, action: 'briefing', page: updated || page, briefing };
}

async function runAgentWriteback(event) {
    const gated = eventGate(event);
    if (!gated.allowed) return { skipped: true, reason: gated.reason };
    if (event.type === 'page_updated') {
        return runPageWriteback(event, event.page);
    }
    return runTaskWriteback(event);
}

async function maybeRunAgentWriteback(event) {
    const key = lockKey(event || {});
    if (inflight.has(key)) return { skipped: true, reason: 'in-flight' };
    inflight.add(key);
    try {
        return await runAgentWriteback(event);
    } finally {
        inflight.delete(key);
    }
}

async function maybeRunAgentWritebackSafe(event) {
    try {
        return await maybeRunAgentWriteback(event);
    } catch (error) {
        logger.error(`[writeback] failed: ${error && error.message ? error.message : error}`);
        return null;
    }
}

async function applyPageWriteback({ companyId, uid, page, briefingOnly }) {
    if (!page) return page;
    const result = await maybeRunAgentWriteback({
        type: 'page_updated',
        companyId,
        uid,
        pageId: recordId(page),
        page,
        briefingOnly: Boolean(briefingOnly),
    });
    if (result && result.page) return result.page;
    return page;
}

module.exports = {
    maybeRunAgentWriteback,
    maybeRunAgentWritebackSafe,
    applyPageWriteback,
    loadProject,
    isWritebackEnabled,
};
