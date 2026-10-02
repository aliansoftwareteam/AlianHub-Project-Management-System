const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const marks = require('../workMarks');
const projectLimits = require('../projectLimits');

// Who may take an item from the work queue right now: a connection holds one item at a time, and a project has a
// bounded number of places for agents at work. A mark here is taken after the claim is written and is only as good
// as that claim: once the claim is gone the mark is free, so nothing has to tidy up after a claim that ran out.

const HAND = 'hand';
const RUNNING = 'running';

const placeScope = (projectId) => `place:${String(projectId).toLowerCase()}`;
const stands = async (mark, holds) => Boolean(mark && mark.by && mark.ref) && holds(mark.ref, mark.by);

/* An in-product agent running on a task of the project fills a place too; its own caps decide whether it starts. */
const runningIn = async (companyId, projectId) => Number(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AGENT_RUNS, data: [{ projectId: { $in: idForms([String(projectId)]) }, status: RUNNING }],
}, 'countDocuments')) || 0;

const takeHand = async ({ companyId, connection, itemId, now, holds }) => {
    const was = await marks.markAt(companyId, HAND, connection);
    if (was && was.ref !== itemId && await stands(was, holds)) return null;
    return marks.take(companyId, HAND, connection, was, { by: connection, ref: itemId, at: now });
};

const takePlace = async ({ companyId, projectId, connection, itemId, open, now, holds }) => {
    const scope = placeScope(projectId);
    const byKey = new Map((await marks.marksIn(companyId, scope)).map((mark) => [mark.key, mark]));
    for (let n = 0; n < open; n += 1) {
        const was = byKey.get(String(n)) || null;
        // eslint-disable-next-line no-await-in-loop
        if (was && was.by !== connection && await stands(was, holds)) continue;
        // eslint-disable-next-line no-await-in-loop
        const got = await marks.take(companyId, scope, String(n), was, { by: connection, ref: itemId, at: now });
        if (got) return got;
    }
    return null;
};

const giveBack = (companyId, itemId, connection) => marks.giveUp(companyId, { ref: String(itemId), ...(connection ? { by: connection } : {}) });

/* For a claim just written. `holds(itemId, connection)` says whether that connection's claim on that item still
 * stands. Answers which rule holds the caller back, if one does; the caller then takes its claim back. */
const takeFor = async ({ companyId, projectId, connection, itemId, now, holds }) => {
    const ref = String(itemId);
    if (!(await takeHand({ companyId, connection, itemId: ref, now, holds }))) return { held: 'one_at_a_time' };
    const [{ atOnce }, running] = await Promise.all([projectLimits.read(companyId, projectId), runningIn(companyId, projectId)]);
    if (await takePlace({ companyId, projectId, connection, itemId: ref, open: atOnce - running, now, holds })) return { held: '' };
    await giveBack(companyId, ref, connection);
    return { held: 'project_full', atOnce };
};

module.exports = { takeFor, giveBack, runningIn };
