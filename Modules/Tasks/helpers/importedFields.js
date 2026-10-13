const { canEditProject } = require('../../../Config/projectAccess');
const { agentOf } = require('../../../Config/agentRequest');
const { createCustomFields } = require('./helper');

const COLUMN = 'custom_';
const FIELD_SETUP = [['project.project_custom_field', 'task.task_custom_field']];

const isColumn = (key) => key.startsWith(COLUMN);
const columnsOf = (tasks) => [...new Set(tasks.flatMap((task) => Object.keys(task).filter(isColumn)))];
const withoutColumns = (task) => Object.fromEntries(Object.entries(task).filter(([key]) => !isColumn(key)));

const hasFieldColumns = (tasks) => tasks.some((task) => Object.keys(task).some(isColumn));

/* Making a field changes how the project is set up, so it takes what the custom field route asks of a person. */
const mayMakeFields = async (userData, projectData) => {
    const uid = userData && userData.id;
    if (!uid || agentOf(uid)) return false;
    return (await canEditProject(projectData.CompanyId, uid, projectData._id, FIELD_SETUP)).allowed === true;
};

/* The rows with their field columns made fields of the project; for a person who may not make fields, the rows
 * without those columns and the names of the columns left out. */
const fieldsFromColumns = async ({ tasks, userData, projectData }) => {
    if (await mayMakeFields(userData, projectData)) return createCustomFields({ tasks, userData, projectData });
    return { tasks: tasks.map(withoutColumns), customFields: [], skippedFields: columnsOf(tasks).map((column) => column.slice(COLUMN.length)) };
};

module.exports = { hasFieldColumns, fieldsFromColumns };
