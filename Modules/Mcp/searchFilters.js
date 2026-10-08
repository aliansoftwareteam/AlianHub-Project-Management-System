const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { escapeRegex } = require('../../utils/escapeRegex');
const { oid } = require('../Automations/engine/tools');
const { isSomeoneElsesPersonalList } = require('../PersonalList/ownership');
const { optionsOf, optionLabel } = require('../CustomField/helpers/fieldValueInput');

// What tasks.search adds by tag, priority and custom field value. Each clause goes beside the caller's own, so it only
// narrows what the person can already open. A tag or a field is looked up only in projects the person can open, so
// whether a name exists elsewhere is never told apart from a name that does not exist.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC = /^[-+]?\d+(\.\d+)?$/;
const PRIORITIES = Object.freeze(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
const TAG_MAX = 120;
const TEXT_MAX = 500;
const PROJECTS_MAX = 500;
const TEXT_TYPES = Object.freeze(['text', 'textarea', 'email', 'phone', 'url']);
const NUMBER_TYPES = Object.freeze(['number', 'money']);
const FIELD_KEYS = Object.freeze(['fieldId', 'equals', 'before', 'after']);
const NO_TAG = 'No tag by that id or name in the projects the person can open. Check tags.list.';
const NO_FIELD = 'That custom field was not found in the projects the person can open. Check the field id.';

const isId = (value) => OBJECT_ID.test(String(value || ''));
const str = (value, max) => String(value === undefined || value === null ? '' : value).slice(0, max);
const given = (value) => value !== undefined && value !== null && value !== '';

const SEARCH_INPUT = Object.freeze({
    tag: { type: 'string', description: 'Only tasks with this tag, by tag id or name (see tags.list)' },
    priority: { type: 'string', enum: [...PRIORITIES], description: 'Only tasks of this priority' },
    field: {
        type: 'object',
        description: 'Only tasks whose custom field equals a value: an option of a dropdown by label or id, true or false for a checkbox, a number, text (any case) or a day. '
            + 'For a date field, before or after a day instead. Days are written YYYY-MM-DD and read as the person\'s own days.',
        properties: {
            fieldId: { type: 'string', description: 'The custom field' },
            equals: { type: ['string', 'number', 'boolean'] },
            before: { type: 'string', description: 'A date field before this day' },
            after: { type: 'string', description: 'A date field after this day' },
        },
        required: ['fieldId'],
        additionalProperties: false,
    },
});

const opens = (vis, uid) => (project) => vis.allowsProject(project._id) && !isSomeoneElsesPersonalList(project, uid);

const tagClause = async (ctx, vis, args) => {
    const wanted = str(args.tag, TAG_MAX).trim();
    if (!wanted) return { error: 'tag needs a tag id or name.' };
    const named = { $or: [{ uid: wanted }, { tagName: { $regex: `^\\s*${escapeRegex(wanted)}\\s*$`, $options: 'i' } }] };
    const projects = await MongoDbCrudOpration(ctx.companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [
            { ...(isId(args.projectId) ? { _id: oid(String(args.projectId)) } : {}), deletedStatusKey: { $nin: [1] }, tagsArray: { $elemMatch: named } },
            { tagsArray: 1, isPersonal: 1, personalOwner: 1 },
            { limit: PROJECTS_MAX },
        ],
    }, 'find');
    const lower = wanted.toLowerCase();
    const uids = (projects || []).filter(opens(vis, ctx.userId))
        .flatMap((project) => (Array.isArray(project.tagsArray) ? project.tagsArray : []))
        .filter((tag) => tag && (String(tag.uid) === wanted || String(tag.tagName || '').trim().toLowerCase() === lower))
        .map((tag) => String(tag.uid));
    return uids.length ? { filter: { tagsArray: { $in: [...new Set(uids)] } } } : { error: NO_TAG };
};

const priorityClause = (args) => {
    const priority = str(args.priority, 20).trim().toUpperCase();
    return PRIORITIES.includes(priority) ? { filter: { Task_Priority: priority } } : { error: `priority must be one of ${PRIORITIES.join(', ')}.` };
};

const visibleField = async (ctx, vis, fieldId) => {
    if (!isId(fieldId)) return null;
    const definition = await MongoDbCrudOpration(ctx.companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELDS,
        data: [{ _id: oid(String(fieldId)) }, { fieldTitle: 1, fieldType: 1, fieldOptions: 1, type: 1, global: 1, projectId: 1, isDelete: 1 }],
    }, 'findOne');
    if (!definition || definition.isDelete === false || definition.type !== 'task') return null;
    return definition.global === true || [].concat(definition.projectId || []).some((id) => vis.allowsProject(id)) ? definition : null;
};

const dayStart = (day, zone) => (DAY.test(String(day)) ? DateTime.fromISO(String(day), { zone }).startOf('day') : null);

/* The web app stores a picked day as a Date and an agent stores it as ISO text, so both are matched. */
const between = (path, from, until) => ({
    $or: [
        { [path]: { $type: 'date', ...(from ? { $gte: from.toJSDate() } : {}), ...(until ? { $lt: until.toJSDate() } : {}) } },
        { [path]: { $type: 'string', $gte: from ? from.toUTC().toISO() : '0', ...(until ? { $lt: until.toUTC().toISO() } : {}) } },
    ],
});

const dateClause = (path, title, asked, zone) => {
    const days = ['equals', 'before', 'after'].filter((key) => given(asked[key]));
    const read = Object.fromEntries(days.map((key) => [key, dayStart(asked[key], zone)]));
    if (days.some((key) => !read[key] || !read[key].isValid)) return { error: `${title} takes days written YYYY-MM-DD.` };
    if (read.equals) return { filter: between(path, read.equals, read.equals.plus({ days: 1 })) };
    return { filter: between(path, read.after ? read.after.plus({ days: 1 }) : null, read.before || null) };
};

const equalsClause = (path, definition, value) => {
    const type = String(definition.fieldType || '');
    const title = definition.fieldTitle || 'That field';
    if (type === 'dropdown') {
        const option = optionsOf(definition).find((entry) => String(entry.id) === String(value).trim() || optionLabel(entry).toLowerCase() === String(value).trim().toLowerCase());
        if (!option) return { error: `${title} has no option ${String(value)}. Its options: ${optionsOf(definition).map(optionLabel).join(', ') || 'none'}.` };
        const id = String(option.id);
        return { filter: { [path]: { $in: NUMERIC.test(id) ? [id, Number(id)] : [id] } } };
    }
    if (type === 'checkbox') {
        const checked = value === true || String(value).toLowerCase() === 'true';
        if (!checked && value !== false && String(value).toLowerCase() !== 'false') return { error: `${title} is a checkbox: give true or false.` };
        return { filter: checked ? { [path]: true } : { [path]: { $ne: true } } };
    }
    if (NUMBER_TYPES.includes(type)) {
        const number = typeof value === 'number' ? value : (NUMERIC.test(String(value).trim()) ? Number(value) : NaN);
        if (!Number.isFinite(number)) return { error: `${title} is a number field: give a number.` };
        return { filter: { [path]: { $in: [String(number), number] } } };
    }
    if (TEXT_TYPES.includes(type)) {
        const text = str(value, TEXT_MAX).trim();
        if (!text) return { error: `${title} needs some text to match.` };
        return { filter: { [path]: { $regex: `^${escapeRegex(text)}$`, $options: 'i' } } };
    }
    return { error: `${title} is a ${type || 'kind of'} field, which search cannot filter by yet.` };
};

const fieldClause = async (ctx, vis, asked) => {
    if (!asked || typeof asked !== 'object' || Array.isArray(asked) || Object.keys(asked).some((key) => !FIELD_KEYS.includes(key))) {
        return { error: 'field takes fieldId with equals, or for a date field before and after.' };
    }
    const definition = await visibleField(ctx, vis, asked.fieldId);
    if (!definition) return { error: NO_FIELD };
    const title = definition.fieldTitle || 'That field';
    const ranged = given(asked.before) || given(asked.after);
    if (ranged && given(asked.equals)) return { error: 'field takes equals, or before and after, not both.' };
    if (!ranged && !given(asked.equals)) return { error: 'field needs equals, or before or after for a date field.' };
    const path = `customField.${String(definition._id)}.fieldValue`;
    if (definition.fieldType === 'date') return dateClause(path, title, asked, await require('../Agents/taskRequests').zoneOf(ctx.userId));
    if (ranged) return { error: `before and after are for a date field, and ${title} is a ${definition.fieldType || 'different'} field.` };
    return equalsClause(path, definition, asked.equals);
};

/* The clauses for what was named, or the first reason one cannot be used. */
const searchFilters = async (ctx, vis, args) => {
    const clauses = [];
    for (const [named, clauseOf] of [
        [given(args.tag), () => tagClause(ctx, vis, args)],
        [given(args.priority), () => priorityClause(args)],
        [args.field !== undefined, () => fieldClause(ctx, vis, args.field)],
    ]) {
        if (!named) continue;
        const out = await clauseOf();
        if (out.error) return { error: out.error };
        clauses.push(out.filter);
    }
    return { clauses };
};

module.exports = { SEARCH_INPUT, searchFilters, PRIORITIES };
