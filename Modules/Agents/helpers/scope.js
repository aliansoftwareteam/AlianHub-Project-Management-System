// Scope resolution — pure. No DB: callers pass in the entity they already loaded.
//
// This is the whole of "an agent can work anywhere". Company / project / sprint /
// task are not four features; they are one `scope` field plus a walk up the tree:
//
//   agents on a task  =  task:<id> ∪ sprint:<id> ∪ folder:<id> ∪ project:<id> ∪ company
//
// Narrower scopes ADD agents; they never hide inherited ones. That is what makes
// the model worth having — a company agent is not re-attached to every new
// project, and a project agent is not re-attached to every new sprint.

const { SCOPE_LEVELS } = require('./agentRules');

const str = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * The chain of scopes that apply to an entity, narrowest first.
 *
 * `entity` is whatever the caller already has to hand — a task, a sprint, a
 * project. Only the ids are read, so a partial projection is fine.
 *
 *   ancestorScopes('task', task)
 *     → [ {task,id}, {sprint,id}, {folder,id}, {project,id}, {company,null} ]
 *
 * Missing links are simply skipped: a task sitting directly in a project with no
 * folder yields no folder entry rather than a broken one.
 */
const ancestorScopes = (entityType, entity = {}, entityId = '') => {
    const chain = [];
    const push = (level, refId) => {
        const id = str(refId);
        if (level !== 'company' && !id) return;
        if (chain.some((c) => c.level === level && str(c.refId) === id)) return;
        chain.push({ level, refId: level === 'company' ? null : id });
    };

    const type = str(entityType);
    const selfId = str(entityId || entity._id);

    if (type === 'task') {
        push('task', selfId);
        push('sprint', entity.sprintId);
        push('folder', entity.folderObjId);
        push('project', entity.ProjectID);
    } else if (type === 'sprint') {
        push('sprint', selfId);
        push('folder', entity.folderId || entity.folderObjId);
        push('project', entity.ProjectID || entity.projectId);
    } else if (type === 'folder') {
        push('folder', selfId);
        push('project', entity.ProjectID || entity.projectId);
    } else if (type === 'project') {
        push('project', selfId);
    }

    // Always in scope, and always last so narrower agents sort first.
    push('company', null);
    return chain;
};

/**
 * Mongo `$or` for "any agent whose scope is in this chain".
 *
 * `oid` is injected so this module stays free of mongoose — the caller supplies a
 * string→ObjectId converter that returns null on bad input.
 */
const buildScopeQuery = (chain = [], oid) => {
    const or = [];
    for (const link of chain) {
        if (link.level === 'company') {
            or.push({ 'scope.level': 'company' });
            continue;
        }
        const id = oid ? oid(link.refId) : link.refId;
        if (!id) continue;
        // refId is stored as whatever was written; match both shapes so a scope
        // saved as a string still resolves.
        or.push({ 'scope.level': link.level, 'scope.refId': { $in: [id, str(link.refId)] } });
    }
    // No valid link at all would mean an unfiltered query, so fall back to
    // company-only rather than returning every agent in the database.
    return or.length ? { $or: or } : { 'scope.level': 'company' };
};

/**
 * Would an agent scoped at `scope` apply to `chain`?
 *
 * The in-memory counterpart of buildScopeQuery, used by the runner to re-check an
 * agent at execution time. Scope is a security boundary, so it is verified again
 * when the action is taken, not trusted from whenever the list was built.
 */
const scopeApplies = (scope = {}, chain = []) => {
    const level = str(scope.level);
    if (!level) return false;
    if (level === 'company') return true;
    const refId = str(scope.refId);
    if (!refId) return false;
    return chain.some((c) => c.level === level && str(c.refId) === refId);
};

/**
 * The inverse direction: which TASKS does this scope cover?
 *
 * buildScopeQuery answers "which agents apply to this task"; this answers "which
 * tasks does this agent apply to". Needed by the test-run picker, which must only
 * ever offer targets the agent is genuinely scoped to — offering one it would then
 * refuse makes the scope look broken.
 *
 * Returns null for a scope that names no valid target, so the caller can say "no
 * tasks here" rather than issuing a query that matches everything.
 */
const taskQueryForScope = (scope = {}, oid) => {
    const level = str(scope.level);
    if (level === 'company') return {};          // every task in the company

    const raw = str(scope.refId);
    if (!raw) return null;
    const id = oid ? oid(raw) : raw;

    // Both shapes, for the same reason as buildScopeQuery: refId is stored as
    // whatever was written, and these task fields are a mix of string and ObjectId
    // across the codebase.
    const both = id ? { $in: [id, raw] } : raw;

    if (level === 'task') return id ? { _id: id } : null;
    if (level === 'sprint') return { sprintId: both };
    if (level === 'folder') return { folderObjId: both };
    if (level === 'project') return { ProjectID: both };
    return null;
};

/** Sort key: narrower scopes first, so a task-specific agent outranks a company one. */
const scopeRank = (scope = {}) => {
    const i = SCOPE_LEVELS.indexOf(str(scope.level));
    return i === -1 ? SCOPE_LEVELS.length : i;
};

/** "Project" / "Sprint" / "Everywhere" — for the settings list. */
const describeScope = (scope = {}) => {
    const level = str(scope.level);
    if (level === 'company') return 'Everywhere';
    if (!level) return 'Unscoped';
    return level.charAt(0).toUpperCase() + level.slice(1);
};

module.exports = {
    ancestorScopes,
    buildScopeQuery,
    taskQueryForScope,
    scopeApplies,
    scopeRank,
    describeScope,
};
