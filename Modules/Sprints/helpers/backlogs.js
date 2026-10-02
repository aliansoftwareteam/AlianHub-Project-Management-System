const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/* The backlog lists a project keeps; a project that never opened its backlog has none. */
const backlogsIn = (companyId, projectId) => (OBJECT_ID.test(String(projectId || ''))
    ? MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{
            projectId: new mongoose.Types.ObjectId(String(projectId)),
            isBacklog: true,
            deletedStatusKey: { $ne: 1 },
        }, '_id name folderId tasks'],
    }, 'find').catch(() => [])
    : Promise.resolve([]));

module.exports = { backlogsIn };
