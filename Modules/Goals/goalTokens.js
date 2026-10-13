const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { crud } = require('./goalStore');
const { sourcesOf, holdsSources } = require('./goalSources');

/* A goal belongs to no project, so a token kept to some projects is given one only through the work it
 * counts: it reads a goal whose every linked list and task, on every target, sits in the token's projects,
 * and no other. A goal that counts no tasks is the whole workspace's and is never given to such a token,
 * and such a token changes no goal. The rule is asked here by everything that acts for a token. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const isNarrowed = (projectIds) => Array.isArray(projectIds) && projectIds.length > 0;
const unique = (values) => [...new Set(values.map(String))];
const oids = (ids) => unique(ids).filter((id) => OBJECT_ID.test(id)).map((id) => new mongoose.Types.ObjectId(id));

const projectsOf = async (companyId, type, ids, field) => {
    if (!ids.length) return new Map();
    const rows = (await MongoDbCrudOpration(companyId, { type, data: [{ _id: { $in: oids(ids) } }, { [field]: 1 }] }, 'find')) || [];
    return new Map(rows.map((row) => [String(row._id), String(row[field] || '')]));
};

/* What a write under a token names as its target (Modules/Mcp/visibility.js assertWritable): the workspace itself,
 * which a token kept to some projects is refused. */
const WRITE_TARGET = Object.freeze({ companyWide: true });

/* The ids, among `goalIds`, of the goals a token kept to `projectIds` may be given. A linked list or task that
 * is gone sits in no project. */
const readableIds = async (companyId, goalIds, projectIds) => {
    const wanted = unique(goalIds);
    if (!isNarrowed(projectIds)) return new Set(wanted);
    const goals = wanted.length ? (await crud(companyId, [{ _id: { $in: oids(wanted) } }, { targets: 1 }, { lean: true }], 'find')) || [] : [];
    const linked = (goal) => (goal.targets || []).filter(holdsSources).map(sourcesOf);
    const all = goals.flatMap(linked);
    const [listProjects, taskProjects] = await Promise.all([
        projectsOf(companyId, SCHEMA_TYPE.SPRINTS, all.flatMap((sources) => sources.sprintIds), 'projectId'),
        projectsOf(companyId, SCHEMA_TYPE.TASKS, all.flatMap((sources) => sources.taskIds), 'ProjectID'),
    ]);
    const inside = new Set(projectIds.map(String));
    const within = (sources) => sources.sprintIds.every((id) => inside.has(listProjects.get(id))) && sources.taskIds.every((id) => inside.has(taskProjects.get(id)));
    return new Set(goals.filter((goal) => linked(goal).length > 0 && linked(goal).every(within)).map((goal) => String(goal._id)));
};

module.exports = { WRITE_TARGET, isNarrowed, readableIds };
