/* A stand-in for POST /task/find over a list of task rows: the parts of $match, $skip, $limit,
   $facet and the subtask count $group that the List, Board, Table and Calendar loaders send.
   Rows come back in group-index order. Any other request is recorded in `posts`. */
import { vi } from 'vitest';

export const server = { tasks: [], calls: [], posts: [] };

export function resetServer(tasks = []) {
    server.tasks = tasks;
    server.calls = [];
    server.posts = [];
}

const holds = (value, want) => {
    if (want && typeof want === 'object' && !Array.isArray(want)) {
        if ('objId' in want) return holds(value, want.objId);
        if ('$eq' in want) return value === want.$eq;
        if ('$in' in want) return want.$in.includes(value);
    }
    return value === want;
};

const matches = (task, condition = {}) => Object.entries(condition).every(([field, want]) => {
    if (field === '$and') return want.every((part) => matches(task, part));
    if (field === 'objId') return Object.entries(want).every(([key, value]) => task[key] === value);
    return holds(task[field], want);
});

const stage = (stages, name) => stages.find((entry) => name in entry)?.[name];
const copy = (task) => ({ ...task });
const inOrder = (a, b) => ((a.groupByStatusIndex ?? 0) - (b.groupByStatusIndex ?? 0)) || (a._id > b._id ? 1 : -1);

function childCounts(rows) {
    const byParent = new Map();
    rows.forEach((task) => {
        const entry = byParent.get(task.ParentTaskId) || { _id: task.ParentTaskId, total: 0, completed: 0 };
        entry.total += 1;
        if (task.statusType === 'close') entry.completed += 1;
        byParent.set(task.ParentTaskId, entry);
    });
    return [...byParent.values()];
}

function answer(stages) {
    const rows = server.tasks.filter((task) => matches(task, stage(stages, '$match'))).sort(inOrder);
    const facet = stage(stages, '$facet');
    if (facet?.result) {
        const skip = stage(facet.result, '$skip') || 0;
        return [{ result: rows.slice(skip, skip + 35).map(copy), count: rows.length ? [{ count: rows.length }] : [] }];
    }
    if (facet) {
        return [Object.fromEntries(Object.entries(facet).map(([key, pipeline]) => {
            const count = rows.filter((task) => matches(task, stage(pipeline, '$match'))).length;
            return [key, count ? [{ count }] : []];
        }))];
    }
    if (stage(stages, '$group')) return childCounts(rows);
    const skip = stage(stages, '$skip') || 0;
    const limit = stage(stages, '$limit');
    return (limit ? rows.slice(skip, skip + limit) : rows).map(copy);
}

export const apiRequest = vi.fn((method, url, body) => {
    const stages = body?.findQuery;
    if (!Array.isArray(stages)) {
        server.posts.push({ method, url, body });
        return Promise.resolve({ status: 200, data: { status: true } });
    }
    server.calls.push(stages);
    return Promise.resolve({ status: 200, data: answer(stages) });
});

const readsOf = (parentId) => (stages) => stage(stages, '$match')?.ParentTaskId === parentId;

export const childReads = (parentId) => server.calls.filter(readsOf(parentId));
