const mongoose = require('mongoose');
const marks = require('./workMarks');

// "Anything wider than one task waits", kept across calls. What one connection changed in a project on its own,
// with no person approving that change, is counted by task over the last WINDOW_MINUTES. Past the project's count
// (./projectLimits) a change to one more task waits for a person, and a task already counted stays open to the
// agent working on it. Asked by projectPolicy.ask alone.

const WINDOW_MINUTES = 10;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
const ATTEMPTS = 5;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Taking or giving back a queue item changes no task.
const NOT_A_CHANGE = new Set(['queue.claim', 'queue.release']);

const scopeOf = (projectId) => `direct:${String(projectId).toLowerCase()}`;
const connectionOf = (actor) => marks.connectionOf(actor) || `client:${actor.clientId || ''}:${actor.userId || ''}`;

/* The task or doc a change names. A change that names neither, a new task for one, counts as one of its own. */
const namedBy = (params) => {
    const found = [['task', params.taskId], ['page', params.pageId]].find(([, id]) => OBJECT_ID.test(String(id || '')));
    return found ? `${found[0]}:${String(found[1]).toLowerCase()}` : '';
};

const recentOf = (row, now) => (Array.isArray(row && row.changed) ? row.changed : [])
    .filter((entry) => entry && new Date(entry.at).getTime() > now - WINDOW_MS);

/* Whether the connection may make this change in the project now, and how many tasks it has changed there when it
 * may not. With `keep` an answer of yes counts the change, by a write that names the row as it was read, so of two
 * calls reaching for the last place one gets it. A write that keeps losing answers no. */
const admit = async ({ companyId, projectId, actor, params = {}, limit, keep = false, now = Date.now() }) => {
    const scope = scopeOf(projectId);
    const key = connectionOf(actor);
    const named = namedBy(params);
    let known = false;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const row = await marks.markAt(companyId, scope, key);
        const recent = recentOf(row, now);
        known = Boolean(named) && recent.some((entry) => entry.id === named);
        if (!known && recent.length >= limit) return { ok: false, counted: recent.length };
        if (!keep) return { ok: true };
        const changed = [...recent.filter((entry) => entry.id !== named), { id: named || `new:${new mongoose.Types.ObjectId()}`, at: new Date(now) }];
        if (await marks.take(companyId, scope, key, row, { changed })) return { ok: true };
    }
    return known ? { ok: true } : { ok: false, counted: limit };
};

const reasonOf = (counted) => `this agent has already changed ${counted} ${counted === 1 ? 'task' : 'tasks'} in this project in the last ${WINDOW_MINUTES} minutes`;

module.exports = { WINDOW_MINUTES, NOT_A_CHANGE, admit, reasonOf };
