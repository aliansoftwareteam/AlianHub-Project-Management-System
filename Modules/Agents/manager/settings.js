const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

// The manager only proposes: every change it offers waits for a person. A project cannot raise this yet.
const LEVEL = 'suggest';

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const shown = (project) => ({ on: Boolean(project && project.agentManager && project.agentManager.on === true), level: LEVEL });

const read = async (companyId, projectId) => shown(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId) }, { agentManager: 1 }],
}, 'findOne'));

const save = async (companyId, projectId, given, updatedBy) => {
    if (!given || typeof given.on !== 'boolean') return { error: 'Send on as true or false.', status: 400 };
    const from = await read(companyId, projectId);
    const agentManager = { on: given.on, updatedBy: String(updatedBy), updatedAt: new Date() };
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId) }, { $set: { agentManager } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (!project) return { error: 'Project not found.', status: 404 };
    return { from, to: shown(project), project, agentManager };
};

module.exports = { LEVEL, read, save };
