const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { projectAsked } = require('../Agents/guard');

/* Each time write of these routes, for the project's rule for agents: the change it is, and the task it lands on. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const text = (value) => (typeof value === 'string' ? value : '');

const named = (body, task) => ({ taskId: text(body[task]), projectId: text(body.projectId) });

const placeOfEntry = async (companyId, id) => {
    if (!OBJECT_ID.test(text(id))) return {};
    const entry = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET, data: [{ _id: new mongoose.Types.ObjectId(id) }, { TicketID: 1, ProjectId: 1 }],
    }, 'findOne');
    return entry ? { taskId: String(entry.TicketID || ''), projectId: String(entry.ProjectId || '') } : {};
};

const logged = projectAsked((req, body) => ({ action: body.isEdit === true ? 'timelog.edit' : 'timelog.create', params: named(body, 'ticketId') }));
const started = projectAsked((req, body) => ({ action: 'timelog.start', params: named(body, 'taskId') }));
const ofEntry = (action) => projectAsked(async (req, body, companyId) => ({ action, params: await placeOfEntry(companyId, body.timeSheetId) }));

module.exports = { logged, started, stopped: ofEntry('timelog.stop'), edited: ofEntry('timelog.edit') };
