const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { pageReachFilter } = require('../Pages/helpers/pageRules');
const { hiddenSprintFilter } = require('../Sprints/helpers/sprintVisibility');
const skillRecord = require('../Agents/skillRecord');
const briefing = require('./askBriefing');
const { askerZone } = require('./askStructured');
const { taskContext, taskSources } = require('./taskContext');

// What the asker attached with @ and the skill they chose with /. The client sends ids only, and every
// id is read again here against the projects the asker can open: an id that does not resolve inside
// them is dropped without saying why, so a guessed id tells the caller nothing.

const MAX_PINNED = 8;
const KINDS = new Set(['task', 'page', 'project', 'list', 'person']);
const BRIEFED = new Set(['project', 'list', 'person']);
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const refsOf = (context) => {
    if (!Array.isArray(context)) return [];
    const seen = new Set();
    const refs = [];
    context.forEach((ref) => {
        const kind = ref && typeof ref.kind === 'string' ? ref.kind : '';
        const id = ref && typeof ref.id === 'string' ? ref.id : '';
        const key = `${kind}:${id}`;
        if (!KINDS.has(kind) || !OBJECT_ID.test(id) || seen.has(key)) return;
        seen.add(key);
        refs.push({ kind, id });
    });
    return refs.slice(0, MAX_PINNED);
};

const statusOf = (task) => ((task.status && typeof task.status === 'object') ? task.status.text : task.status) || task.statusType || '';

const taskSource = (task, nameById) => ({
    kind: 'task',
    id: String(task._id),
    ref: task.TaskKey || String(task._id).slice(-6),
    title: clip(task.TaskName, 160),
    project: nameById.get(String(task.ProjectID)) || '',
    projectId: String(task.ProjectID || ''),
    detail: clip([statusOf(task), task.Task_Priority, clip(task.rawDescription, 400)].filter(Boolean).join(' · '), 600),
    updatedAt: task.updatedAt,
    matchedBy: 'pinned',
    permission: { visibility: 'project', via: 'project' },
});

const pageSource = (page, nameById) => ({
    kind: 'page',
    id: String(page._id),
    ref: `page:${String(page._id).slice(-6)}`,
    title: clip(page.title, 160),
    project: page.ProjectID ? nameById.get(String(page.ProjectID)) || '' : '',
    projectId: page.ProjectID ? String(page.ProjectID) : '',
    detail: clip(page.rawText, 800),
    updatedAt: page.updatedAt,
    matchedBy: 'pinned',
    permission: { visibility: page.visibility === 'private' ? 'private' : (page.ProjectID ? 'project' : 'company') },
});

const projectSource = (project) => ({
    kind: 'project',
    id: String(project._id),
    ref: `project:${String(project._id).slice(-6)}`,
    title: clip(project.ProjectName, 160),
    project: clip(project.ProjectName, 160),
    projectId: String(project._id),
    detail: clip(project.description, 400),
    updatedAt: project.updatedAt,
    matchedBy: 'pinned',
    permission: { visibility: 'project', via: 'project' },
});

const findOne = (companyId, type, filter, fields) => MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'findOne').catch(() => null);

/* `projects` are the rows openProjects returned for this asker, already narrowed by an API token. */
const pinnedSources = async (companyId, uid, { context, projects = [] } = {}) => {
    const refs = refsOf(context);
    if (!refs.length) return [];
    const visibleIds = projects.map((p) => String(p._id));
    const nameById = new Map(projects.map((p) => [String(p._id), p.ProjectName || '']));
    if (!visibleIds.length) return [];
    const sprintClause = refs.some((r) => r.kind === 'task') ? await hiddenSprintFilter(companyId, uid, visibleIds) : {};

    const read = async ({ kind, id }) => {
        if (kind === 'task') {
            const task = await findOne(companyId, SCHEMA_TYPE.TASKS,
                { _id: oid(id), deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true }, ProjectID: { $in: visibleIds }, ...sprintClause },
                'TaskName TaskKey status statusType Task_Priority ProjectID rawDescription updatedAt');
            return task ? taskSource(task, nameById) : null;
        }
        if (kind === 'page') {
            const page = await findOne(companyId, SCHEMA_TYPE.PAGES, {
                _id: oid(id),
                deletedStatusKey: { $ne: 1 },
                ...pageReachFilter({ uid, projectIds: visibleIds }),
            }, 'title rawText ProjectID visibility updatedAt');
            return page ? pageSource(page, nameById) : null;
        }
        if (kind !== 'project' || !visibleIds.includes(id)) return null;
        const project = await findOne(companyId, SCHEMA_TYPE.PROJECTS, { _id: oid(id), deletedStatusKey: { $ne: 1 } }, 'ProjectName description updatedAt');
        return project ? projectSource(project) : null;
    };

    return (await Promise.all(refs.map(read))).filter(Boolean);
};

const sameSource = (a, b) => a.kind === b.kind && String(a.id) === String(b.id);

const withPinned = (gathered, pinned) => {
    if (!pinned || !pinned.length) return gathered;
    const rest = (gathered.sources || []).filter((s) => !pinned.some((p) => sameSource(p, s)));
    return { ...gathered, sources: [...pinned, ...rest] };
};

/* One attached project, with no scope picked, scopes the search the way the project picker would. */
const pinnedProjectId = (context) => {
    const projects = refsOf(context).filter((r) => r.kind === 'project');
    return projects.length === 1 ? projects[0].id : '';
};

const askSkill = async (companyId, key) => {
    const wanted = typeof key === 'string' ? key.trim().toLowerCase() : '';
    if (!wanted) return null;
    try {
        const found = (await skillRecord.listSkills(companyId)).find((s) => String(s.key).toLowerCase() === wanted && s.enabled !== false && !s.retiredAt);
        return found ? { key: found.key, name: clip(found.name, 80), description: clip(found.description, 300) } : null;
    } catch (error) {
        logger.error(`ai ask skill: ${error.message}`);
        return null;
    }
};

const skillPrompt = (skill) => (skill
    ? `\n- The asker chose the skill "${skill.name}"${skill.description ? ` (${skill.description})` : ''}. Shape the answer the way that skill would, from the SOURCES only. It changes nothing here: you are answering, not acting.`
    : '');

const pinnedPrompt = (refs) => (refs.length
    ? `\n- The asker attached ${refs.map((r) => `[${r}]`).join(', ')} with @: the question is about them first, and the sources for them come first.`
    : '');

const quietly = async (label, work) => {
    try {
        return await work();
    } catch (error) {
        logger.error(`ai ask ${label}: ${error.message}`);
        return null;
    }
};

/* Comments, subtasks and linked docs of an attached task, under refs that name the task. */
const taskExtras = async (companyId, uid, source, visibleIds) => {
    const ctx = await taskContext({ companyId, uid, taskId: source.id });
    if (!ctx || !visibleIds.includes(String(ctx.task.ProjectID))) return [];
    return taskSources(ctx, source.project).slice(1).map((s) => (s.kind === 'comment' ? { ...s, ref: `${source.ref}/${s.ref}` } : s));
};

/* The project a question asks about as a whole: one in scope, or the one it names. */
const overviewProjectId = (gathered) => {
    const scoped = gathered.scopedProjectIds || [];
    if (scoped.length === 1) return String(scoped[0]);
    const named = (gathered.intent && gathered.intent.projects) || [];
    return named.length === 1 ? String(named[0].id) : '';
};

const briefingsFor = async (companyId, uid, { refs, gathered, question, now }) => {
    const projects = gathered.projects || [];
    const byId = new Map(projects.map((p) => [String(p._id), p]));
    const wanted = refs.filter((r) => BRIEFED.has(r.kind));
    if (!wanted.length && briefing.isOverviewQuestion(question)) {
        const id = overviewProjectId(gathered);
        if (id && byId.has(id)) wanted.push({ kind: 'project', id, implied: true });
    }
    if (!wanted.length) return [];
    const timeZone = await askerZone(uid).catch(() => 'UTC');
    const read = ({ kind, id }) => quietly(`briefing ${kind}`, () => {
        if (kind === 'project') return byId.has(id) ? briefing.projectBriefing(companyId, uid, { project: byId.get(id), openIds: [...byId.keys()], now, timeZone }) : null;
        if (kind === 'list') return briefing.listBriefing(companyId, uid, { listId: id, projects, now, timeZone });
        return briefing.personBriefing(companyId, uid, { personId: id, projects, now, timeZone });
    });
    const out = await Promise.all(wanted.map(read));
    return out.map((sources, i) => ({ ref: wanted[i], sources: sources || [] }));
};

const dedupe = (sources) => {
    const kept = [];
    sources.forEach((s) => { if (!kept.some((k) => sameSource(k, s))) kept.push(s); });
    return kept;
};

/* The gathered sources with the attached ones first, and the lines the system prompt gains. A project,
 * list or person attached with @, or a whole-project question in a one-project scope, adds its briefing. */
const pin = async (companyId, uid, gathered, { context, skill, question } = {}) => {
    const refs = refsOf(context);
    const visibleIds = (gathered.projects || []).map((p) => String(p._id));
    const [pinned, chosen, briefed] = await Promise.all([
        pinnedSources(companyId, uid, { context, projects: gathered.projects || [] }),
        askSkill(companyId, skill),
        refs.length || question ? briefingsFor(companyId, uid, { refs, gathered, question, now: Date.now() }) : [],
    ]);
    const extras = await Promise.all(pinned.filter((s) => s.kind === 'task')
        .map((s) => quietly('task extras', () => taskExtras(companyId, uid, s, visibleIds))));
    const briefSources = briefed.flatMap((b) => b.sources);
    const lead = dedupe([...briefSources.filter((s) => s.kind !== 'task'), ...pinned, ...extras.flat().filter(Boolean), ...briefSources]);
    const attached = [
        ...briefed.filter((b) => !b.ref.implied && b.sources.length).map((b) => b.sources[0].ref),
        ...pinned.filter((s) => !BRIEFED.has(s.kind) || !briefed.some((b) => b.sources.length && sameSource(b.sources[0], s))).map((s) => s.ref),
    ];
    const system = `${pinnedPrompt([...new Set(attached)])}${briefSources.length ? briefing.BRIEFING_SYSTEM : ''}${skillPrompt(chosen)}`;
    return { gathered: withPinned(gathered, lead), system, briefed: briefSources.length > 0 };
};

module.exports = { pin, pinnedSources, withPinned, pinnedProjectId, askSkill, skillPrompt, MAX_PINNED };
