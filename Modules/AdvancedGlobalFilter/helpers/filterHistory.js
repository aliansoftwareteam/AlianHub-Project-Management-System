const logger = require('../../../Config/loggerConfig');
const { canReadProject } = require('../../../Config/projectAccess');
const { HandleHistory } = require('../../Tasks/helpers/helper');
const { employeeNameOf, escapeText } = require('../../Tasks/helpers/taskWriteFields');

const HISTORY_KEY = 'Project_Filter';
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const SERVER_BUILT_HISTORY = [{ type: 'project', key: HISTORY_KEY }];

/* A saved filter belongs to a person, not a project; the row goes to the project it was changed from, when the caller can see it. */
const recordFilterChange = async ({ companyId, uid, projectId, filter, verb }) => {
    if (!filter || !OBJECT_ID.test(String(projectId || ''))) return;
    const access = await canReadProject(companyId, uid, String(projectId));
    if (!access || !access.allowed) return;
    const actor = { id: String(uid), Employee_Name: escapeText(await employeeNameOf(String(uid))) };
    const entry = { key: HISTORY_KEY, message: `<b>${actor.Employee_Name}</b> has been ${verb} <b>${escapeText(filter.name)}</b> filter` };
    await HandleHistory('project', companyId, String(projectId), null, entry, actor)
        .catch((error) => logger.error(`saved filter history: ${(error && error.message) || JSON.stringify(error)}`));
};

module.exports = { HISTORY_KEY, SERVER_BUILT_HISTORY, recordFilterChange };
