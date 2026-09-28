/* Status conditions name a project's status, but a task stores its status three
 * ways (see resolveStatus in engine/tools.js): the key, the type and a subdoc. A
 * name compared with the type never matches, and a key is only unique within its
 * project, so a condition on a named status holds `<projectId>:<key>` refs
 * (field `statusRef`) and keeps the name as `label` to read back. `statusType`
 * stays for conditions on the type itself: open, in progress, done.
 *
 * Pure: the caller loads the projects' statuses and passes them in. */

const STATUS_TYPES = Object.freeze(['default_active', 'active', 'close']);

// A project has exactly one status of each of these types, so a word for the type
// picks the same status a project's own name for it would.
const ONE_PER_PROJECT = ['default_active', 'close'];

const GENERIC_WORDS = Object.freeze({
    open: 'default_active',
    'to do': 'default_active',
    todo: 'default_active',
    default_active: 'default_active',
    'in progress': 'active',
    active: 'active',
    done: 'close',
    closed: 'close',
    close: 'close',
    complete: 'close',
    completed: 'close',
});

const TYPE_WORD = Object.freeze({ default_active: 'open', active: 'in progress', close: 'done' });

const STATUS_FIELDS = ['statusType', 'statusKey', 'status'];

const KEY_OP = Object.freeze({ eq: 'in', neq: 'notIn', in: 'in', notIn: 'notIn', changedTo: 'changedTo', changedFrom: 'changedFrom' });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fold = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const joinWords = (words, last = 'and') => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} ${last} ${words[words.length - 1]}`);

const statusRef = (projectId, key) => `${projectId}:${key}`;
const refProject = (ref) => String(ref).slice(0, String(ref).lastIndexOf(':'));
const refKey = (ref) => {
    const key = String(ref).slice(String(ref).lastIndexOf(':') + 1);
    return Number.isFinite(Number(key)) && key !== '' ? Number(key) : key;
};

/* Real projects store each status flat; some paths nest it under `convertStatus`. */
const catalogueOf = (projects = []) => (projects || []).flatMap((project) => (Array.isArray(project?.taskStatusData) ? project.taskStatusData : [])
    .map((row) => (row && row.convertStatus ? row.convertStatus : row))
    .filter((s) => s && s.key !== undefined && s.key !== null && s.name)
    .map((s) => ({ projectId: String(project._id), key: s.key, name: String(s.name), type: s.type || '' })));

const inRuleScope = (statuses, scope = {}) => {
    const ids = (scope && scope.allProjects === false && Array.isArray(scope.projectIds)) ? scope.projectIds.map(String) : [];
    if (!ids.length) return statuses;
    return statuses.filter((s) => ids.includes(s.projectId));
};

const uniqueNames = (statuses) => [...new Map(statuses.map((s) => [fold(s.name), s.name])).values()];

/* `generic` is for words a person is writing now; stored rules resolve names only,
 * so a migration never turns one status into a whole type. */
const resolveStatusName = (word, statuses = [], { generic = true } = {}) => {
    const raw = String(word ?? '').trim();
    const wanted = fold(raw);
    const named = statuses.filter((s) => fold(s.name) === wanted);
    const type = generic ? GENERIC_WORDS[wanted] : undefined;
    if (type && named.every((s) => s.type === type) && (!named.length || ONE_PER_PROJECT.includes(type))) return { type };
    if (named.length) return { refs: [...new Set(named.map((s) => statusRef(s.projectId, s.key)))], label: named[0].name };

    const near = uniqueNames(statuses.filter((s) => wanted && fold(s.name).includes(wanted)));
    if (near.length > 1) return { error: `"${raw}" could be ${joinWords(near, 'or')} — use the full name.` };
    if (near.length === 1) return { error: `I do not know a status called "${raw}". Did you mean ${near[0]}?` };
    const all = uniqueNames(statuses);
    return { error: all.length ? `I do not know a status called "${raw}". The statuses are ${joinWords(all)}.` : `I do not know a status called "${raw}".` };
};

const TYPE_OP = Object.freeze({ in: 'eq', notIn: 'neq' });

/* "Blocked or In Review" names several statuses; tried only when the whole
 * phrase is not itself a status name. */
const resolveEither = (word, statuses) => {
    const parts = String(word ?? '').split(/\s+or\s+/i).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const found = parts.map((part) => resolveStatusName(part, statuses));
    const failed = found.find((f) => f.error);
    if (failed) return failed;
    if (found.some((f) => f.type)) return { error: `"${String(word).trim()}" mixes statuses with open, in progress or done; a condition can name either, not both.` };
    return { refs: [...new Set(found.flatMap((f) => f.refs))], label: found.map((f) => f.label).join(' or ') };
};

const statusClause = (op, word, statuses) => {
    let found = resolveStatusName(word, statuses);
    if (found.error) found = resolveEither(word, statuses) || found;
    if (found.error) return found;
    if (found.type) return { op: TYPE_OP[op] || op, field: 'statusType', value: found.type };
    return { op: KEY_OP[op], field: 'statusRef', value: found.refs, label: found.label };
};

const isStatusTypeField = (field) => field === 'statusType' || field === 'task.statusType';

/* Resolves a stored name condition to refs. A leaf is converted whole or not at
 * all, so a rule is never narrowed to the names that happened to resolve. */
const resolveStoredLeaf = (node, statuses, generic) => {
    if (!KEY_OP[node.op]) return { node };
    const values = Array.isArray(node.value) ? node.value : [node.value];
    if (values.every((v) => STATUS_TYPES.includes(v))) return { node };
    const resolved = values.map((v) => resolveStatusName(v, statuses, { generic }));
    const missing = values.filter((v, i) => !resolved[i].refs && !resolved[i].type);
    if (missing.length) return { node, unresolved: missing.map(String), errors: resolved.filter((r) => r.error).map((r) => r.error) };
    if (resolved.some((r) => r.type)) {
        if (resolved.length === 1) return { node: { op: node.op, field: 'statusType', value: resolved[0].type }, changed: true };
        return { node, unresolved: values.map(String), errors: [`A status condition cannot mix "${values.join('", "')}" as names and types.`] };
    }
    const refs = [...new Set(resolved.flatMap((r) => r.refs))];
    return { node: { op: KEY_OP[node.op], field: 'statusRef', value: refs, label: resolved.map((r) => r.label).join(' or ') }, changed: true };
};

/* An all-projects rule written before a project existed still means that
 * project's status of the same name; projects the refs already cover keep
 * their key, so a rename there does not move the rule. */
const extendToNewProjects = (node, statuses) => {
    const refs = Array.isArray(node.value) ? node.value.map(String) : [];
    const covered = new Set(refs.map(refProject));
    const extra = statuses
        .filter((s) => !covered.has(s.projectId) && fold(s.name) === fold(node.label))
        .map((s) => statusRef(s.projectId, s.key));
    return extra.length ? { ...node, value: [...refs, ...extra] } : node;
};

/* { conditions, changed, unresolved, errors }. `extend` is the read-time view of
 * a rule; the migration leaves it off so it persists only what was written. */
const normaliseStatusConditions = (conditions, statuses = [], scope = {}, { extend = true, generic = false } = {}) => {
    const pool = inRuleScope(statuses, scope);
    const allProjects = !scope || scope.allProjects !== false || !(scope.projectIds || []).length;
    const unresolved = [];
    const errors = [];
    let changed = false;
    const walk = (node) => {
        if (!isPlainObject(node) || !node.op) return node;
        if (['and', 'or'].includes(node.op) && Array.isArray(node.args)) return { ...node, args: node.args.map(walk) };
        if (node.op === 'not') return node.args ? { ...node, args: node.args.map(walk) } : { ...node, arg: walk(node.arg) };
        if (isStatusTypeField(node.field)) {
            const out = resolveStoredLeaf(node, pool, generic);
            if (out.unresolved) unresolved.push(...out.unresolved);
            if (out.errors) errors.push(...out.errors);
            if (out.changed) changed = true;
            return out.node;
        }
        if (extend && allProjects && node.field === 'statusRef' && node.label) return extendToNewProjects(node, statuses);
        return node;
    };
    return { conditions: walk(conditions), changed, unresolved: [...new Set(unresolved)], errors: [...new Set(errors)] };
};

const someLeaf = (conditions, test) => {
    const walk = (node) => {
        if (!isPlainObject(node) || !node.op) return false;
        if (Array.isArray(node.args)) return node.args.some(walk);
        if (node.op === 'not') return walk(node.arg);
        return test(node);
    };
    return walk(conditions);
};

const namesStatus = (node) => isStatusTypeField(node.field) && KEY_OP[node.op] && [].concat(node.value).some((v) => !STATUS_TYPES.includes(v));

const hasStatusNames = (conditions) => someLeaf(conditions, namesStatus);
const needsStatusCatalogue = (conditions) => someLeaf(conditions, (node) => node.field === 'statusRef' || namesStatus(node));

const withStatusRef = (snapshot) => {
    if (!isPlainObject(snapshot) || !snapshot.ProjectID || snapshot.statusKey === undefined || snapshot.statusKey === null) return snapshot;
    return { ...snapshot, statusRef: statusRef(snapshot.ProjectID, snapshot.statusKey) };
};

const withStatusChange = (changedFields = []) => {
    const list = Array.isArray(changedFields) ? changedFields.map(String) : [];
    return list.some((f) => STATUS_FIELDS.includes(f)) && !list.includes('statusRef') ? [...list, 'statusRef'] : list;
};

const statusNameOf = (ref, statuses = []) => {
    const hit = statuses.find((s) => statusRef(s.projectId, s.key) === String(ref));
    return hit ? hit.name : null;
};

const statusNameOfTask = (task = {}, statuses = []) => (task.ProjectID && task.statusKey !== undefined && task.statusKey !== null
    ? statusNameOf(statusRef(task.ProjectID, task.statusKey), statuses)
    : null);

/* Mongo filter for a statusRef clause. A change clause is read as the state the
 * task is in now, which is how the backtest reads every change clause. */
const statusRefMatch = (node) => {
    const pairs = [].concat(node.value || []).map((ref) => ({ ProjectID: refProject(ref), statusKey: refKey(ref) }));
    if (node.op === 'notIn') return pairs.length ? { $nor: pairs } : {};
    if (['in', 'changedTo', 'eq'].includes(node.op)) return pairs.length ? { $or: pairs } : { _id: null };
    return {};
};

module.exports = {
    STATUS_TYPES,
    TYPE_WORD,
    statusRef,
    refProject,
    refKey,
    catalogueOf,
    inRuleScope,
    resolveStatusName,
    statusClause,
    normaliseStatusConditions,
    hasStatusNames,
    needsStatusCatalogue,
    withStatusRef,
    withStatusChange,
    statusNameOf,
    statusNameOfTask,
    statusRefMatch,
};
