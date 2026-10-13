const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { personNamesIn } = require('./outsideActors');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const oid = (id) => new mongoose.Types.ObjectId(id);
const find = async (companyId, type, data) => (await MongoDbCrudOpration(String(companyId), { type, data }, 'find')) || [];
const named = (rows, field) => rows.filter((row) => row[field]).map((row) => [String(row._id), String(row[field])]);

const visibleProjects = (companyId, uid) => require('../Agents/scope').visibleProjects(companyId, uid);

/* Each answers [id, name] pairs for the ids the reader can open, so a row never names what its reader could not
 * look up. The list is read by owners and admins, who read past a private list inside a project they can open. */
const NAMERS = {
    task: async (companyId, uid, ids) => {
        const readable = await require('../Tasks/helpers/taskWritePlacement').readableTaskIds(companyId, uid, ids);
        return readable.length ? named(await find(companyId, SCHEMA_TYPE.TASKS, [{ _id: { $in: readable.map(oid) } }, { TaskName: 1 }]), 'TaskName') : [];
    },
    project: async (companyId, uid, ids) => named((await visibleProjects(companyId, uid)).filter((project) => ids.includes(String(project._id))), 'ProjectName'),
    sprint: async (companyId, uid, ids) => {
        const open = new Set((await visibleProjects(companyId, uid)).map((project) => String(project._id)));
        const lists = await find(companyId, SCHEMA_TYPE.SPRINTS, [{ _id: { $in: ids.map(oid) } }, { name: 1, projectId: 1 }]);
        return named(lists.filter((list) => open.has(String(list.projectId))), 'name');
    },
    agent: async (companyId, uid, ids) => named(await find(companyId, SCHEMA_TYPE.AGENTS, [{ _id: { $in: ids.map(oid) } }, { name: 1 }]), 'name'),
    /* A member row is written with the person's id or with the id of their seat in this workspace. */
    member: async (companyId, uid, ids) => {
        const seats = await find(companyId, SCHEMA_TYPE.COMPANY_USERS, [{ $or: [{ _id: { $in: ids.map(oid) } }, { userId: { $in: ids } }] }, { userId: 1 }]);
        const people = await personNamesIn(companyId, [...new Set(seats.map((seat) => String(seat.userId)))]);
        return seats.flatMap((seat) => [String(seat._id), String(seat.userId)].filter((id) => ids.includes(id)).map((id) => [id, people.get(String(seat.userId))]))
            .filter(([, name]) => name);
    },
};

const unnamed = (row) => Boolean(row && !row.entityName && NAMERS[row.entityType] && OBJECT_ID.test(String(row.entityId || '')));

/* Adds `entityLabel` to each row that holds only the id of what it is about. The stored row is not changed. */
const nameRows = async (companyId, uid, rows) => {
    const wanted = rows.filter(unnamed);
    if (!wanted.length) return rows;
    const names = new Map();
    await Promise.all([...new Set(wanted.map((row) => row.entityType))].map(async (type) => {
        const ids = [...new Set(wanted.filter((row) => row.entityType === type).map((row) => String(row.entityId)))];
        try {
            (await NAMERS[type](String(companyId), String(uid || ''), ids)).forEach(([id, name]) => names.set(`${type}:${id}`, name));
        } catch (error) {
            logger.error(`audit entity names ${companyId} ${type}: ${error.message}`);
        }
    }));
    return rows.map((row) => {
        const name = unnamed(row) ? names.get(`${row.entityType}:${row.entityId}`) : '';
        return name ? { ...row, entityLabel: name } : row;
    });
};

module.exports = { nameRows };
