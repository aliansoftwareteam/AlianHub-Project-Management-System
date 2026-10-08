const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const socketEmitter = require('../../../event/socketEventEmitter');
const playbooks = require('../../Agents/rolePlaybooks');
const { RuleError, cacheKey, loadRules, plain } = require('../rules');

// A project's dispatcher settings live on its assignment rules row, so one rule set says who and which role takes a task.
// A rule names a role ('blueprint/slug') and conditions on fields the task already has; every condition it names must
// hold, and a list condition holds when the task has any of its values.

const MODES = Object.freeze(['off', 'suggest', 'apply']);
const THRESHOLD = Object.freeze({ MIN: 50, MAX: 100, DEFAULT: 80 });
const MAX_RULES = 50;
const MAX_ROLES = 100;
const MAX_VALUES = 20;
const MAX_TEXT = 200;
const NUMBER_LISTS = Object.freeze(['taskTypeKeys', 'statusKeys']);
const TEXT_LISTS = Object.freeze(['tags', 'priorities', 'sprintIds']);
const DEFAULTS = Object.freeze({ mode: 'off', threshold: THRESHOLD.DEFAULT, modelGuess: false, roles: [], rules: [], revision: 0 });

const roleKey = (role) => `${role.blueprint}/${role.slug}`;
const roleOf = (key) => {
    const [blueprint, slug, rest] = String(key || '').split('/');
    return rest === undefined && blueprint && slug ? playbooks.find(blueprint, slug) : null;
};
const roleName = (key) => (roleOf(key) || {}).name || '';
const WHO_MAX = 300;
const roleWho = (companyId, key) => playbooks.whoFor(companyId, key, WHO_MAX);

const textOf = (value) => String(value === undefined || value === null ? '' : value).trim().slice(0, MAX_TEXT);

const cleanWhen = (when) => {
    const given = when && typeof when === 'object' ? when : {};
    const out = {};
    NUMBER_LISTS.forEach((key) => {
        if (Array.isArray(given[key]) && given[key].length) out[key] = [...new Set(given[key].map(Number).filter(Number.isFinite))].slice(0, MAX_VALUES);
    });
    TEXT_LISTS.forEach((key) => {
        if (Array.isArray(given[key]) && given[key].length) out[key] = [...new Set(given[key].map(textOf).filter(Boolean))].slice(0, MAX_VALUES);
    });
    if (Array.isArray(given.fields) && given.fields.length) {
        out.fields = given.fields.filter((field) => field && textOf(field.id)).slice(0, MAX_VALUES).map((field) => ({ id: textOf(field.id), value: textOf(field.value) }));
    }
    return Object.fromEntries(Object.entries(out).filter(([, values]) => values.length));
};

const view = (stored) => {
    const given = stored && typeof stored === 'object' ? stored : {};
    const threshold = Number(given.threshold);
    return {
        mode: MODES.includes(given.mode) ? given.mode : DEFAULTS.mode,
        threshold: Number.isInteger(threshold) && threshold >= THRESHOLD.MIN && threshold <= THRESHOLD.MAX ? threshold : THRESHOLD.DEFAULT,
        modelGuess: given.modelGuess === true,
        roles: Array.isArray(given.roles) ? given.roles.map(String) : [],
        rules: Array.isArray(given.rules) ? given.rules.map((rule) => ({ role: String((rule && rule.role) || ''), when: cleanWhen(rule && rule.when) })) : [],
        revision: Number(given.revision) || 0,
    };
};

const settingsOf = (rules) => view(rules && rules.dispatcher);

const load = async (companyId, projectId) => settingsOf(await loadRules(companyId, projectId));

function validate(body = {}) {
    const mode = body.mode === undefined ? DEFAULTS.mode : body.mode;
    if (!MODES.includes(mode)) throw new RuleError('mode must be off, suggest or apply.');
    const threshold = body.threshold === undefined ? THRESHOLD.DEFAULT : body.threshold;
    if (!Number.isInteger(threshold) || threshold < THRESHOLD.MIN || threshold > THRESHOLD.MAX) {
        throw new RuleError(`threshold must be a whole number from ${THRESHOLD.MIN} to ${THRESHOLD.MAX}.`);
    }
    if (body.modelGuess !== undefined && typeof body.modelGuess !== 'boolean') throw new RuleError('modelGuess must be true or false.');
    const roles = body.roles === undefined ? [] : body.roles;
    if (!Array.isArray(roles) || roles.length > MAX_ROLES) throw new RuleError(`roles must be a list of at most ${MAX_ROLES} roles.`);
    roles.forEach((key) => { if (!roleOf(key)) throw new RuleError(`There is no role "${textOf(key)}".`); });
    const rules = body.rules === undefined ? [] : body.rules;
    if (!Array.isArray(rules) || rules.length > MAX_RULES) throw new RuleError(`rules must be a list of at most ${MAX_RULES} rules.`);
    const cleanRules = rules.map((rule) => {
        if (!roleOf(rule && rule.role)) throw new RuleError(`There is no role "${textOf(rule && rule.role)}".`);
        const when = cleanWhen(rule.when);
        if (!Object.keys(when).length) throw new RuleError('Every routing rule needs at least one condition.');
        return { role: String(rule.role), when };
    });
    return { mode, threshold, modelGuess: body.modelGuess === true, roles: [...new Set(roles.map(String))], rules: cleanRules };
}

const readRow = async (companyId, projectId) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.ASSIGNMENT_RULES,
    data: [{ projectId: String(projectId) }, { dispatcher: 1 }],
}, 'findOne'));

async function save(companyId, projectId, body, actorId) {
    const input = validate(body);
    const existing = await readRow(companyId, projectId);
    const dispatcher = { ...input, revision: (Number(existing && existing.dispatcher && existing.dispatcher.revision) || 0) + 1, updatedBy: String(actorId), updatedAt: new Date() };
    if (existing) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ASSIGNMENT_RULES,
            data: [{ projectId: String(projectId) }, { $set: { dispatcher } }],
        }, 'updateOne');
    } else {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ASSIGNMENT_RULES,
            data: { projectId: String(projectId), entries: [], dispatcher, revision: 1 },
        }, 'save');
    }
    removeCache(cacheKey(companyId, projectId));
    socketEmitter.emit('update', {
        type: 'update', module: 'dispatcherSettings', companyId: String(companyId), data: { projectId: String(projectId), revision: dispatcher.revision },
    });
    return view(dispatcher);
}

const addRule = async (companyId, projectId, rule, actorId) => {
    const current = await load(companyId, projectId);
    return save(companyId, projectId, { ...current, rules: [...current.rules, rule] }, actorId);
};

const fieldValue = (task, id) => {
    const entry = task.customField && task.customField[id];
    return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.fieldValue : entry;
};

const anyOf = (values, actual) => {
    const have = (Array.isArray(actual) ? actual : [actual]).filter((value) => value !== undefined && value !== null).map(String);
    return values.some((value) => have.includes(String(value)));
};

const CONDITIONS = Object.freeze({
    taskTypeKeys: (values, task) => anyOf(values, task.TaskTypeKey),
    statusKeys: (values, task) => anyOf(values, task.statusKey),
    tags: (values, task) => anyOf(values, task.tagsArray || []),
    priorities: (values, task) => anyOf(values, task.Task_Priority),
    sprintIds: (values, task) => anyOf(values, task.sprintId),
    fields: (fields, task) => fields.every((field) => anyOf([field.value], fieldValue(task, field.id))),
});

const matches = (when, task) => {
    const named = Object.entries(when || {}).filter(([key]) => CONDITIONS[key]);
    return named.length > 0 && named.every(([key, values]) => CONDITIONS[key](values, task));
};

const roleChoices = () => playbooks.all().map((role) => ({ key: roleKey(role), name: role.name, blueprint: role.blueprint, department: role.department }));

module.exports = { MODES, THRESHOLD, MAX_RULES, DEFAULTS, roleKey, roleOf, roleName, roleWho, view, settingsOf, load, validate, save, addRule, matches, roleChoices };
