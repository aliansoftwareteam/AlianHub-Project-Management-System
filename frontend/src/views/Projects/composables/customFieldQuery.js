import moment from 'moment';
import { dueDateBuckets } from '../taskGroups';
import { fieldAppliesToTask, fieldTaskTypes } from '@fieldTaskTypes';
import { typeModuleOf } from '@fieldTypes';
import { maxOf as ratingMaxOf, text as ratingText } from '@fieldTypes/rating';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const VALUE_PATH = /^customField\.([a-f0-9]{24})\.fieldValue$/i;
const GROUP_PREFIX = 'cf:';
const TEXT_TYPES = ['text', 'textarea', 'email', 'phone', 'url'];
const NUMBER_TYPES = ['number', 'money'];
const NUMERIC_TYPES = [...NUMBER_TYPES, 'rating', 'progress'];
const LIST_TYPES = ['dropdown', 'people'];
const EMPTY_VALUES = [null, '', []];
const CHECKED = [true, 'true'];

export const GROUPABLE_TYPES = Object.freeze(['dropdown', 'checkbox', 'date', 'people', 'rating']);
export const FILTERABLE_TYPES = Object.freeze(['dropdown', 'checkbox', 'date', 'people', ...NUMERIC_TYPES, ...TEXT_TYPES]);

export const valuePath = (fieldId) => `customField.${fieldId}.fieldValue`;
export const fieldIdOfPath = (path) => VALUE_PATH.exec(String(path || ''))?.[1] || null;
export const customGroupId = (fieldId) => `${GROUP_PREFIX}${fieldId}`;
export const customFieldIdOf = (value) => {
    if (typeof value !== 'string' || !value.startsWith(GROUP_PREFIX)) return null;
    const id = value.slice(GROUP_PREFIX.length);
    return OBJECT_ID.test(id) ? id : null;
};

/* A task of another type keeps its stored value but does not use the field, so every query reads it as having no value. */
const inTypes = (types) => ({ TaskTypeKey: { $in: types } });
const valueInTypes = (condition, types) => (types.length ? { ...condition, ...inTypes(types) } : condition);
const blankOrOtherType = (blank, valued, types) => (types.length ? { $nor: [{ ...valued, ...inTypes(types) }] } : blank);

const hasId = (def) => Boolean(def && OBJECT_ID.test(String(def._id || '')));

export const customGroupOptions = (defs) => (defs || [])
    .filter((def) => hasId(def) && GROUPABLE_TYPES.includes(def.fieldType))
    .map((def) => ({ id: customGroupId(def._id), title: def.fieldTitle || '', fieldType: def.fieldType }));

const storedValue = (task, fieldId) => {
    const entry = (task?.customField || {})[fieldId];
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && !(entry instanceof Date)) return entry.fieldValue;
    return entry;
};

const isBlank = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

const timeOf = (value) => {
    if (isBlank(value)) return null;
    const time = value?.seconds ? value.seconds * 1000 : new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
};

/* Stored values are text from the task panel, Dates from imports and numbers from AI fills,
   so the server reads them through $convert, where an unreadable value becomes null. */
const converted = (path, to) => ({ $convert: { input: `$${path}`, to, onError: null, onNull: null } });
const millisOf = (path) => ({ $toLong: converted(path, 'date') });
const present = (expr, ...tests) => ({ $expr: { $and: [{ $ne: [expr, null] }, ...tests] } });

const DATED_BUCKETS = ['range', 'lt', 'gt'];

function dateBucketCondition(bucket, path) {
    const time = millisOf(path);
    const from = bucket.seconds * 1000;
    switch (bucket.operation) {
        case 'range':
            return present(time, { $gte: [time, from] }, { $lt: [time, bucket.endSeconds * 1000] });
        case 'lt':
            return present(time, { $lte: [time, from] });
        case 'gt':
            return present(time, { $gte: [time, from] });
        default:
            return { $expr: { $eq: [time, null] } };
    }
}

const groupBase = (def, types) => ({
    customFieldId: String(def._id),
    customFieldType: def.fieldType,
    ...(types.length ? { customFieldTaskTypes: types } : {}),
    searchKey: valuePath(def._id),
    indexName: 'groupByStatusIndex',
    isExpanded: true,
    tasksArray: []
});

/* Groups carry their own server condition, so each group fetches through the same
   company-scoped, visibility-checked task query as the status groups do. */
export function customFieldGroups(def, { t = (key) => key, now = new Date(), people = [] } = {}) {
    if (!hasId(def)) return [];
    const path = valuePath(def._id);
    const types = fieldTaskTypes(def);
    const base = groupBase(def, types);
    const none = { ...base, name: t('ViewGroups.no_value'), value: '', searchValue: '' };

    if (def.fieldType === 'dropdown') {
        const options = (def.fieldOptions || []).filter((option) => option && option.id !== undefined && option.id !== null);
        return [
            ...options.map((option) => ({
                ...base,
                name: option.label || option.value || '',
                textColor: option.color,
                value: String(option.id),
                searchValue: String(option.id),
                conditions: [valueInTypes({ [path]: String(option.id) }, types)]
            })),
            { ...none, conditions: [blankOrOtherType({ [path]: { $in: EMPTY_VALUES } }, { [path]: { $nin: EMPTY_VALUES } }, types)] }
        ];
    }
    if (def.fieldType === 'people') {
        return [
            ...people.filter((person) => person?.id).map((person) => ({
                ...base,
                name: person.name || '',
                value: String(person.id),
                searchValue: String(person.id),
                conditions: [valueInTypes({ [path]: String(person.id) }, types)]
            })),
            { ...none, conditions: [blankOrOtherType({ [path]: { $in: EMPTY_VALUES } }, { [path]: { $nin: EMPTY_VALUES } }, types)] }
        ];
    }
    if (def.fieldType === 'rating') {
        const ratings = Array.from({ length: ratingMaxOf(def) }, (_, at) => ratingMaxOf(def) - at);
        return [
            ...ratings.map((rating) => ({
                ...base,
                name: ratingText(rating, def),
                value: rating,
                searchValue: rating,
                conditions: [valueInTypes({ [path]: { $in: [rating, String(rating)] } }, types)]
            })),
            { ...none, conditions: [blankOrOtherType({ [path]: { $in: EMPTY_VALUES } }, { [path]: { $nin: EMPTY_VALUES } }, types)] }
        ];
    }
    if (def.fieldType === 'checkbox') {
        return [
            { ...base, name: t('ViewGroups.checked'), value: true, searchValue: true, conditions: [valueInTypes({ [path]: { $in: CHECKED } }, types)] },
            { ...base, name: t('ViewGroups.unchecked'), value: false, searchValue: false, conditions: [blankOrOtherType({ [path]: { $nin: CHECKED } }, { [path]: { $in: CHECKED } }, types)] }
        ];
    }
    if (def.fieldType === 'date') {
        return dueDateBuckets(now, t).map((bucket) => ({
            ...base,
            ...bucket,
            name: bucket.value === 'OVERDUE' ? t('ViewGroups.date_past') : (bucket.value === 'NO_DUE_DATE' ? t('ViewGroups.no_value') : bucket.name),
            textColor: undefined,
            searchValue: bucket.value,
            dropDisabled: true,
            conditions: [DATED_BUCKETS.includes(bucket.operation)
                ? valueInTypes(dateBucketCondition(bucket, path), types)
                : blankOrOtherType(dateBucketCondition(bucket, path), { $expr: { $ne: [millisOf(path), null] } }, types)]
        }));
    }
    return [];
}

function dateMatches(time, item) {
    if (time === null) return item.operation === 'non';
    const seconds = time / 1000;
    switch (item.operation) {
        case 'range':
            return seconds >= item.seconds && seconds < item.endSeconds;
        case 'lt':
            return seconds <= item.seconds;
        case 'gt':
            return seconds >= item.seconds;
        default:
            return false;
    }
}

export function customGroupMatches(task, item) {
    const value = fieldAppliesToTask({ fieldTaskTypes: item.customFieldTaskTypes }, task) ? storedValue(task, item.customFieldId) : undefined;
    if (LIST_TYPES.includes(item.customFieldType)) {
        const chosen = [].concat(isBlank(value) ? [] : value).filter((id) => !isBlank(id)).map(String);
        return item.searchValue === '' ? chosen.length === 0 : chosen.includes(String(item.searchValue));
    }
    if (item.customFieldType === 'rating') return item.searchValue === '' ? isBlank(value) : !isBlank(value) && Number(value) === Number(item.searchValue);
    if (item.customFieldType === 'checkbox') return CHECKED.includes(value) === (item.searchValue === true);
    if (item.customFieldType === 'date') return dateMatches(timeOf(value), item);
    return false;
}

/* A drop writes the group's value, which the server refuses on a task of another type; the view declines the drop instead of
   showing the row in a group it is not in. `taskTypeKey` may be the text of a data attribute. */
export const groupTakesTask = (item, taskTypeKey) => fieldAppliesToTask({ fieldTaskTypes: item?.customFieldTaskTypes }, { TaskTypeKey: taskTypeKey });

/* Sortable reads `true` from a put function as "from any list", so an allowed drop names the one drag group it may come from. */
export const putFrom = (groupName, item) => (to, from, dragged) => (groupTakesTask(item, dragged?.dataset?.taskType) ? [groupName] : false);

/* A date group is a range, not a value, so nothing can be dropped into one. */
export function customGroupUpdate(item) {
    if (!item?.customFieldId || item.dropDisabled) return null;
    if (LIST_TYPES.includes(item.customFieldType)) return { fieldValue: item.searchValue ? [item.searchValue] : [], _id: item.customFieldId };
    if (item.customFieldType === 'rating') return { fieldValue: item.searchValue, _id: item.customFieldId };
    if (item.customFieldType === 'checkbox') return { fieldValue: item.searchValue === true, _id: item.customFieldId };
    return null;
}

export const customFilterOptions = (defs) => (defs || [])
    .filter((def) => hasId(def) && FILTERABLE_TYPES.includes(def.fieldType))
    .map((def) => ({ value: `customField.${def._id}`, name: def.fieldTitle || '', type: 'custom', fieldType: def.fieldType, filterOn: valuePath(def._id) }));

const IS_SET = { value: ':set', name: 'cf_is_set' };
const IS_EMPTY = { value: ':empty', name: 'cf_is_empty' };

export function comparisonsFor(fieldType) {
    if (LIST_TYPES.includes(fieldType)) return [{ value: ':', name: 'Is' }, { value: ':!=', name: 'Not_Equals_To' }, IS_SET, IS_EMPTY];
    if (fieldType === 'checkbox') return [{ value: ':=', name: 'Is' }];
    if (NUMERIC_TYPES.includes(fieldType)) {
        return [{ value: ':=', name: 'Equal_To' }, { value: ':!=', name: 'Not_Equals_To' }, { value: ':>', name: 'Greater_Than' }, { value: ':<', name: 'Less_Than' }, IS_SET, IS_EMPTY];
    }
    if (fieldType === 'date') return [{ value: ':=', name: 'cf_on' }, { value: ':>', name: 'cf_after' }, { value: ':<', name: 'cf_before' }, IS_SET, IS_EMPTY];
    if (TEXT_TYPES.includes(fieldType)) return [{ value: ':~', name: 'cf_contains' }, { value: ':=', name: 'Is' }, IS_SET, IS_EMPTY];
    return [];
}

export const needsValue = (comparison) => comparison !== IS_SET.value && comparison !== IS_EMPTY.value;

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function numberCondition(path, comparison, raw) {
    const number = Number(String(raw ?? '').replace(/,/g, ''));
    if (raw === '' || raw === null || !Number.isFinite(number)) return null;
    const value = converted(path, 'double');
    if (comparison === ':=') return { $expr: { $eq: [value, number] } };
    if (comparison === ':!=') return { $expr: { $ne: [value, number] } };
    if (comparison === ':>') return present(value, { $gt: [value, number] });
    if (comparison === ':<') return present(value, { $lt: [value, number] });
    return null;
}

function dateCondition(path, comparison, raw) {
    const day = moment(String(raw || ''), 'YYYY-MM-DD', true);
    if (!day.isValid()) return null;
    const start = day.clone().startOf('day').valueOf();
    const end = day.clone().endOf('day').valueOf();
    const time = millisOf(path);
    if (comparison === ':=') return present(time, { $gte: [time, start] }, { $lte: [time, end] });
    if (comparison === ':>') return present(time, { $gt: [time, end] });
    if (comparison === ':<') return present(time, { $lt: [time, start] });
    return null;
}

/* A saved filter row keeps no task types, so they are read from the field definition each time the query is built. */
export function customFilterCondition(row, defs = []) {
    const condition = unscopedFilterCondition(row);
    const fieldId = fieldIdOfPath(row?.name?.filterOn);
    const types = fieldTaskTypes((defs || []).find((def) => String(def?._id) === fieldId));
    if (!condition || !types.length) return condition;
    return matchesNoValue(row) ? { $or: [condition, { TaskTypeKey: { $nin: types } }] } : { ...condition, ...inTypes(types) };
}

function matchesNoValue(row) {
    const comparison = row.comparison?.value;
    const type = row.name.fieldType;
    if (comparison === IS_EMPTY.value) return true;
    if (comparison === IS_SET.value) return false;
    if (type === 'checkbox') return !CHECKED.includes(row.values[0]);
    return comparison === ':!=' && (LIST_TYPES.includes(type) || NUMERIC_TYPES.includes(type));
}

function unscopedFilterCondition(row) {
    const path = row?.name?.filterOn;
    if (!fieldIdOfPath(path) || row.name.value !== path.replace(/\.fieldValue$/, '')) return null;
    const comparison = row.comparison?.value;
    const values = Array.isArray(row.values) ? row.values : [];
    const type = row.name.fieldType;

    if (comparison === IS_SET.value) return { [path]: { $nin: EMPTY_VALUES } };
    if (comparison === IS_EMPTY.value) return { [path]: { $in: EMPTY_VALUES } };
    if (!values.length) return null;

    if (LIST_TYPES.includes(type)) {
        const ids = values.map(String);
        if (comparison === ':') return { [path]: { $in: ids } };
        if (comparison === ':!=') return { [path]: { $nin: ids } };
        return null;
    }
    if (type === 'checkbox') return { [path]: CHECKED.includes(values[0]) ? { $in: CHECKED } : { $nin: CHECKED } };
    if (NUMERIC_TYPES.includes(type)) return numberCondition(path, comparison, values[0]);
    if (type === 'date') return dateCondition(path, comparison, values[0]);
    if (TEXT_TYPES.includes(type)) {
        const text = String(values[0]);
        if (comparison === ':~') return { [path]: { $regex: escapeRegExp(text), $options: 'i' } };
        if (comparison === ':=') return { [path]: text };
    }
    return null;
}

export function customSortValue(def, task, context = {}) {
    if (!hasId(def) || !fieldAppliesToTask(def, task)) return null;
    const value = storedValue(task, String(def._id));
    const type = typeModuleOf(def.fieldType);
    if (type) return type.sortValue(value, def, context);
    switch (def.fieldType) {
        case 'checkbox':
            return CHECKED.includes(value) ? 1 : 0;
        case 'dropdown': {
            const first = [].concat(isBlank(value) ? [] : value)[0];
            const rank = (def.fieldOptions || []).findIndex((option) => String(option?.id) === String(first));
            return rank === -1 ? null : rank;
        }
        case 'date':
            return timeOf(value);
        default: {
            if (isBlank(value)) return null;
            const number = Number(String(value).replace(/,/g, ''));
            if (NUMBER_TYPES.includes(def.fieldType) || ['formula', 'rollup'].includes(def.fieldType)) {
                return Number.isFinite(number) ? number : String(value);
            }
            return String(value);
        }
    }
}

const idsByName = (users) => (users || [])
    .filter((user) => user?._id)
    .sort((a, b) => String(a.Employee_Name || '').localeCompare(String(b.Employee_Name || ''), undefined, { sensitivity: 'base' }))
    .map((user) => String(user._id));

/* A people field stores ids, so the server orders by where the first person stands among the ids in name order. */
function peopleRank(field, users) {
    const peopleByName = idsByName(users);
    const first = { $arrayElemAt: [{ $cond: [{ $isArray: `$${field}` }, `$${field}`, []] }, 0] };
    const rank = { $indexOfArray: [peopleByName, first] };
    return { $cond: [{ $gte: [rank, 0] }, rank, null] };
}

/* Numbers are kept as text, so a plain $sort puts "10" before "9"; values that are not
   numbers fall back to themselves and still sort among their own kind. */
export function tableSortStages(sortKey, defs = [], { users = [] } = {}) {
    const [field, rawDir] = String(sortKey || '').split(':');
    const dir = Number(rawDir) === -1 ? -1 : 1;
    const fieldId = fieldIdOfPath(field);
    if (!fieldId) return [{ $sort: { [field]: dir, _id: 1 } }];
    const def = (defs || []).find((entry) => String(entry?._id) === fieldId);
    const types = fieldTaskTypes(def);
    const value = def?.fieldType === 'people'
        ? peopleRank(field, users)
        : { $convert: { input: `$${field}`, to: 'double', onError: `$${field}`, onNull: null } };
    return [
        { $addFields: { cfSortValue: types.length ? { $cond: [{ $in: ['$TaskTypeKey', types] }, value, null] } : value } },
        { $sort: { cfSortValue: dir, _id: 1 } }
    ];
}
