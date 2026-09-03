const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getTask, oid } = require('../Automations/engine/tools');
const logger = require('../../Config/loggerConfig');

const ACCEPTANCE_HEADING = /^\s*(acceptance|acceptance criteria|done when|definition of done|ac)\s*[:\-–]?\s*$/i;
const ACCEPTANCE_INLINE = /(acceptance criteria|done when|definition of done)\s*[:\-–]\s*(.+)/i;
const GOAL_INLINE = /(goal|objective|why)\s*[:\-–]\s*(.+)/i;

const plain = (html) => String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/* Pull acceptance criteria out of the description prose. A heading takes the
 * lines under it; an inline "Acceptance: …" takes the rest of that line. */
const acceptanceFrom = (text) => {
    const lines = String(text || '').split('\n');
    const out = [];
    let collecting = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (ACCEPTANCE_HEADING.test(line)) { collecting = true; continue; }
        const inline = line.match(ACCEPTANCE_INLINE);
        if (inline) { out.push(...inline[2].split(/\s*·\s*|\s*;\s*/).map((s) => s.trim()).filter(Boolean)); continue; }
        if (!collecting) continue;
        if (!line) { if (out.length) collecting = false; continue; }
        if (/^[A-Z][\w ]{2,30}:$/.test(line)) { collecting = false; continue; }
        out.push(line.replace(/^[•\-*\d.]+\s*/, ''));
    }
    return out.filter(Boolean).slice(0, 20);
};

const goalFrom = (text) => {
    const inline = String(text || '').match(GOAL_INLINE);
    if (inline) return inline[2].trim().slice(0, 500);
    const first = String(text || '').split('\n').map((l) => l.trim()).find(Boolean);
    return (first || '').slice(0, 500);
};

const REL_LABEL = {
    blocks: 'blocks', blocked_by: 'blocked by', duplicates: 'duplicates',
    duplicated_by: 'duplicated by', relates_to: 'relates to',
};

/* What the thread has settled, without an LLM: the newest comments in order,
 * flagged when they read as a decision or a question still open. */
const threadDigest = (comments) => {
    const rows = (comments || []).slice(-12);
    return rows.map((c) => {
        const text = plain(c.comment || c.message || c.body || '').slice(0, 600);
        return {
            at: c.createdAt || c.commentDate || null,
            byType: c.actorType === 'agent' ? 'agent' : 'human',
            decision: /\b(agreed|decided|we will|let's|confirmed|approved|no,? we)\b/i.test(text),
            open: /\?\s*$/.test(text.trim()),
            text,
        };
    }).filter((c) => c.text);
};

/* task.get returns this, never a row: enough for an agent to do the right work
 * without asking, and to know what it must not decide alone. */
const buildBrief = async (ctx, taskId) => {
    const task = await getTask(ctx.companyId, taskId);
    const description = plain(task.description || task.rawDescription || '');

    const [comments, project, sprint, relatedRows, pages] = await Promise.all([
        MongoDbCrudOpration(ctx.companyId, {
            type: SCHEMA_TYPE.COMMENTS,
            data: [{ taskId: String(task._id), deletedStatusKey: { $ne: 1 } }, null, { sort: { createdAt: 1 }, limit: 60 }],
        }, 'find').catch(() => []),
        MongoDbCrudOpration(ctx.companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(task.ProjectID) }] }, 'findOne').catch(() => null),
        task.sprintId
            ? MongoDbCrudOpration(ctx.companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: oid(task.sprintId) }] }, 'findOne').catch(() => null)
            : Promise.resolve(null),
        (task.relations || []).length
            ? MongoDbCrudOpration(ctx.companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: { $in: (task.relations || []).map((r) => oid(r.taskId)).filter(Boolean) } }, { TaskName: 1, TaskKey: 1, status: 1, statusType: 1 }],
            }, 'find').catch(() => [])
            : Promise.resolve([]),
        MongoDbCrudOpration(ctx.companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ linkedTasks: String(task._id), deletedStatusKey: { $ne: 1 } }, { title: 1, updatedAt: 1 }, { limit: 10 }],
        }, 'find').catch(() => []),
    ]);

    const relatedById = new Map((relatedRows || []).map((r) => [String(r._id), r]));
    const acceptance = acceptanceFrom(description);
    const checklist = (task.checklistArray || [])
        .map((c) => (typeof c === 'string' ? c : c.name || c.title || ''))
        .filter(Boolean);

    return {
        taskId: String(task._id),
        key: task.TaskKey || '',
        title: task.TaskName || '',
        status: task.status || '',
        statusType: task.statusType || '',
        priority: task.Task_Priority || '',
        dueDate: task.DueDate || null,
        estimateHours: Number(task.totalEstimatedTime || 0) / 3600 || 0,
        project: project ? { id: String(project._id), name: project.ProjectName || project.name || '' } : null,
        sprint: sprint ? { id: String(sprint._id), name: sprint.sprintName || sprint.name || '' } : null,

        goal: goalFrom(description),
        description,
        acceptanceCriteria: acceptance.length ? acceptance : checklist,
        checklist,

        relations: (task.relations || []).map((r) => {
            const other = relatedById.get(String(r.taskId));
            return {
                type: REL_LABEL[r.type] || r.type || 'relates to',
                taskId: String(r.taskId || ''),
                key: other ? other.TaskKey || '' : '',
                title: other ? other.TaskName || '' : '',
                status: other ? other.status || '' : '',
            };
        }),
        links: (task.links || []).map((l) => ({ url: l.url || String(l), label: l.label || '', kind: l.kind || 'link' })),
        linkedDocs: (pages || []).map((p) => ({ pageId: String(p._id), title: p.title || '', updatedAt: p.updatedAt || null })),

        thread: threadDigest(comments),
        commentCount: (comments || []).length,

        // The boundary, restated where the agent will actually read it.
        youMayNot: ['Set this task to Done — a person closes it', 'Merge, deploy to production, or delete anything'],
    };
};

const safeBuildBrief = async (ctx, taskId) => {
    try {
        return await buildBrief(ctx, taskId);
    } catch (error) {
        logger.error(`mcp brief ${taskId}: ${error.message}`);
        throw error;
    }
};

module.exports = { buildBrief: safeBuildBrief, plain, acceptanceFrom, goalFrom, threadDigest };
