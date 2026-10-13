/* CommonJS on purpose: webpack consumes it in the app and root Jest loads it untranspiled, so the
   server's fixture test (tests/goals-fixture.test.js) sends exactly what the page sends. The path
   lives here for the same reason: config/env.js reads `window`, which that test does not have. */
const V2_GOALS = '/api/v2/goals';

const NUMBER = 'number';
const CURRENCY = 'currency';
const BOOLEAN = 'boolean';
const TASKS = 'tasks';
const KINDS = [NUMBER, CURRENCY, BOOLEAN, TASKS];
const VISIBILITIES = ['private', 'people', 'workspace'];
const SORTS = ['name', 'progress'];
const PERIODS = ['current', 'upcoming', 'past', 'none'];
const LIMITS = Object.freeze({ name: 120, description: 2000, unit: 20, targets: 20, weight: 100, sprintIds: 20, taskIds: 100 });
const SOURCE_KINDS = ['sprintIds', 'taskIds'];

const GOAL_KEYS = ['name', 'description', 'periodStart', 'periodEnd', 'visibility', 'sharedWith', 'color', 'ownerUserId'];
const FIELDS = [...GOAL_KEYS, 'kind', 'weight', 'start', 'target', 'current', 'unit', 'currencyCode', 'done', 'targets', 'sources'];

/* How a target is drawn and set. A kind added later gets a row here and a branch in GoalTarget.vue;
   until then a kind that is not listed is shown with its progress and nothing to press. */
const KIND_VIEW = Object.freeze({ [NUMBER]: 'measured', [CURRENCY]: 'measured', [BOOLEAN]: 'flag', [TASKS]: 'counted' });
const kindOf = (target) => KIND_VIEW[target && target.kind] || 'other';
const isMeasured = (kind) => KIND_VIEW[kind] === 'measured';

const goalPath = (id) => `${V2_GOALS}/${id}`;
const targetPath = (id, targetId) => `${goalPath(id)}/targets/${targetId}`;

const squeezed = (text) => String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
const blank = (value) => value === undefined || value === null || String(value).trim() === '';
const numberOf = (value) => (blank(value) ? undefined : Number(value));

const tidy = (key, value) => {
    if (key === 'name') return squeezed(value);
    if (key === 'description') return String(value).trim();
    return value;
};

/* A new goal leaves out what was left empty; a change keeps it, because emptying a field is a change. */
const goalFields = (form, { keepEmpty = false } = {}) => Object.fromEntries(GOAL_KEYS
    .filter((key) => form[key] !== undefined && (keepEmpty || Array.isArray(form[key]) || !blank(form[key])))
    .map((key) => [key, tidy(key, form[key])]));

const weightOf = (value) => (blank(value) ? 1 : Number(value));

const sourcesOf = (sources) => Object.fromEntries(SOURCE_KINDS.map((kind) => [kind, [...new Set(((sources || {})[kind] || []).map(String))]]));
const sourceCount = (sources) => SOURCE_KINDS.reduce((count, kind) => count + sourcesOf(sources)[kind].length, 0);
const withoutSources = (sources, dropped) => {
    const out = sourcesOf(dropped);
    return Object.fromEntries(Object.entries(sourcesOf(sources)).map(([kind, ids]) => [kind, ids.filter((id) => !out[kind].includes(id))]));
};
const sameSources = (a, b) => sourceCount(a) === sourceCount(b) && sourceCount(withoutSources(a, b)) === 0;

const targetFields = (form) => {
    const base = { kind: form.kind, name: squeezed(form.name), weight: weightOf(form.weight) };
    if (form.kind === TASKS) return { ...base, sources: sourcesOf(form.sources) };
    if (!isMeasured(form.kind)) return base;
    const unit = String(form.unit || '').trim();
    const optional = { start: numberOf(form.start), target: numberOf(form.target), current: numberOf(form.current), unit: unit || undefined };
    return {
        ...base,
        ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
        ...(form.kind === CURRENCY ? { currencyCode: form.currencyCode } : {})
    };
};

/* Only what differs from the stored target is sent: its kind is fixed, and its value has a request of its own.
   The lists and tasks it is counted from are one value: the server replaces the set it holds with the set it is sent. */
const targetChanges = (stored, form) => {
    const wanted = { name: squeezed(form.name), weight: weightOf(form.weight) };
    if (isMeasured(stored.kind)) Object.assign(wanted, { start: Number(form.start), target: Number(form.target), unit: String(form.unit || '').trim() });
    if (stored.kind === CURRENCY) wanted.currencyCode = form.currencyCode;
    const was = { unit: '', ...stored };
    const changed = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => value !== was[key]));
    return stored.kind === TASKS && !sameSources(stored.sources, form.sources) ? { ...changed, sources: sourcesOf(form.sources) } : changed;
};

const listRequest = ({ archived = false, mine = false } = {}) => {
    const query = [archived && 'archived=true', mine && 'mine=true'].filter(Boolean).join('&');
    return { method: 'get', path: query ? `${V2_GOALS}?${query}` : V2_GOALS };
};
const readRequest = (id) => ({ method: 'get', path: goalPath(id) });
const forTaskRequest = (taskId) => ({ method: 'get', path: `${V2_GOALS}/for-task/${taskId}` });
const createRequest = (form) => ({ method: 'post', path: V2_GOALS, body: goalFields(form) });
const updateRequest = (id, changes) => ({ method: 'patch', path: goalPath(id), body: goalFields(changes, { keepEmpty: true }) });
const archiveRequest = (id) => ({ method: 'post', path: `${goalPath(id)}/archive` });
const summariseRequest = (id) => ({ method: 'post', path: `${goalPath(id)}/summary`, body: {} });
const restoreRequest = (id) => ({ method: 'post', path: `${goalPath(id)}/restore` });
const addTargetRequest = (id, form) => ({ method: 'post', path: `${goalPath(id)}/targets`, body: targetFields(form) });
const editTargetRequest = (id, stored, form) => ({ method: 'patch', path: targetPath(id, stored.id), body: targetChanges(stored, form) });
const sourcesRequest = (id, target, sources) => ({ method: 'patch', path: targetPath(id, target.id), body: { sources: sourcesOf(sources) } });
const removeTargetRequest = (id, targetId) => ({ method: 'delete', path: targetPath(id, targetId) });
const valueOf = (target, value) => (target.kind === BOOLEAN ? { done: value === true } : { current: Number(value) });
const valueRequest = (id, target, value) => ({ method: 'put', path: `${targetPath(id, target.id)}/value`, body: valueOf(target, value) });

const pad = (n) => String(n).padStart(2, '0');
const todayOf = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const periodBucket = (goal, today) => {
    const { periodStart: start, periodEnd: end } = goal;
    if (!start && !end) return 'none';
    if (start && start > today) return 'upcoming';
    if (end && end < today) return 'past';
    return 'current';
};

const byProgress = (a, b) => (b.progressPct || 0) - (a.progressPct || 0);

const groupGoals = (goals, today, sort = 'name') => PERIODS
    .map((id) => {
        const inPeriod = goals.filter((goal) => periodBucket(goal, today) === id);
        return { id, goals: sort === 'progress' ? [...inPeriod].sort(byProgress) : inPeriod };
    })
    .filter((group) => group.goals.length);

const isReached = (target) => Boolean(target.reachedAt) || target.progressPct >= 100;
const reachedCount = (goal) => (goal.targets || []).filter(isReached).length;
const rangeOf = (target) => (Number(target.target) < Number(target.start) ? 'down' : 'up');

const checkGoal = (form) => {
    const errors = {};
    if (form.name !== undefined && (!squeezed(form.name) || squeezed(form.name).length > LIMITS.name)) errors.name = 'Goals.error_name';
    if (form.description !== undefined && String(form.description).trim().length > LIMITS.description) errors.description = 'Goals.error_description';
    if (form.periodStart && form.periodEnd && form.periodEnd < form.periodStart) errors.periodEnd = 'Goals.error_periodEnd';
    return errors;
};

const wholeWeight = (value) => {
    const weight = Number(value);
    return Number.isInteger(weight) && weight >= 1 && weight <= LIMITS.weight;
};

const checkTarget = (form) => {
    const errors = {};
    if (!squeezed(form.name) || squeezed(form.name).length > LIMITS.name) errors.name = 'Goals.error_name';
    if (!blank(form.weight) && !wholeWeight(form.weight)) errors.weight = 'Goals.error_weight';
    if (form.kind === TASKS) {
        const linked = sourcesOf(form.sources);
        if (linked.sprintIds.length > LIMITS.sprintIds) errors.sources = 'Goals.sources_lists_full';
        else if (linked.taskIds.length > LIMITS.taskIds) errors.sources = 'Goals.sources_tasks_full';
    }
    if (!isMeasured(form.kind)) return errors;
    const [start, target, current] = [form.start, form.target, form.current].map(numberOf);
    if (start !== undefined && !Number.isFinite(start)) errors.start = 'Goals.error_number';
    if (current !== undefined && !Number.isFinite(current)) errors.current = 'Goals.error_number';
    if (target === undefined) errors.target = 'Goals.error_target_required';
    else if (!Number.isFinite(target)) errors.target = 'Goals.error_number';
    else if (!errors.start && target === (start === undefined ? 0 : start)) errors.target = 'Goals.error_target';
    if (String(form.unit || '').trim().length > LIMITS.unit) errors.unit = 'Goals.error_unit';
    if (form.kind === CURRENCY && !form.currencyCode) errors.currencyCode = 'Goals.error_currencyCode';
    return errors;
};

/* The server names the field it refused, nested for a target sent with its goal ("targets.1.kind")
   and down to the one list or task for what a target is counted from ("sources.sprintIds.1"). */
const pathOf = (field) => String(field || '').split('.');
const fieldOf = (field) => (pathOf(field).includes('sources') ? 'sources' : pathOf(field).pop());
const errorKey = (field) => (FIELDS.includes(fieldOf(field)) ? `Goals.error_${fieldOf(field)}` : 'Goals.error_generic');

const REFUSAL_CODES = ['source_not_found', 'source_not_shared', 'sources_would_drop', 'counted_from_tasks'];
const refusalKey = ({ code, field } = {}) => (REFUSAL_CODES.includes(code) ? `Goals.error_${code}` : errorKey(field));

/* A refusal lists the sources at fault, or points at one by its place in the set that was sent. */
const refusedSources = ({ field, sources } = {}, sent) => {
    if (sources) return sourcesOf(sources);
    const path = pathOf(field);
    const [kind, place] = path.slice(path.indexOf('sources') + 1);
    const pointed = path.includes('sources') && SOURCE_KINDS.includes(kind) && place !== undefined;
    const id = pointed ? sourcesOf(sent)[kind][Number(place)] : undefined;
    return sourcesOf(id ? { [kind]: [id] } : {});
};

/* What the person who hands a goal over is left with, by the server's own access rule
   (Modules/Goals/helpers/goalAccess.js): said to them before they confirm. */
const afterHandover = (goal, { myId, privileged }) => {
    const workspace = goal.visibility === 'workspace';
    return {
        sees: workspace || (goal.visibility === 'people' && (goal.sharedWith || []).map(String).includes(String(myId))),
        edits: workspace && privileged === true
    };
};

module.exports = {
    V2_GOALS, KINDS, VISIBILITIES, SORTS, PERIODS, LIMITS, NUMBER, CURRENCY, BOOLEAN, TASKS, SOURCE_KINDS,
    kindOf, isMeasured, listRequest, readRequest, forTaskRequest, createRequest, updateRequest, archiveRequest, restoreRequest, summariseRequest,
    addTargetRequest, editTargetRequest, sourcesRequest, removeTargetRequest, valueRequest, valueOf,
    sourcesOf, sourceCount, withoutSources, refusalKey, refusedSources,
    todayOf, periodBucket, groupGoals, isReached, reachedCount, rangeOf, checkGoal, checkTarget, fieldOf, errorKey, afterHandover
};
