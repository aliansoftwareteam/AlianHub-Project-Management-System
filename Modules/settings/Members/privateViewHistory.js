const logger = require('../../../Config/loggerConfig');
const { canReadProject } = require('../../../Config/projectAccess');
const { HandleHistory } = require('../../Tasks/helpers/helper');
const { employeeNameOf, escapeText } = require('../../Tasks/helpers/taskWriteFields');
const { HISTORY } = require('../../Project/helpers/projectHistory');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const has = (object, field) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, field);
const isEmbed = (view) => has(view, 'url') || has(view, 'html');
const storedView = (previous, id) => ((previous && previous.ProjectRequiredComponent) || [])
    .find((view) => view && id !== undefined && String(view.id) === String(id));

const added = ({ A, data }) => {
    const pinned = data.isPin ? 'pinned' : '';
    return { view: data, message: `<b>${A}</b> has added the <b> ${pinned} private ${isEmbed(data) ? 'Embed View' : 'View'} </b> as <b>${escapeText(data.name)}</b>` };
};

const renamed = ({ A, data, key, previous }) => {
    const view = storedView(previous, data.id);
    if (key !== 'name' || !view || String(view.name) === String(data.name)) return null;
    return { view, message: `<b>${A}</b> has changed the  <b> Embed View name </b> as <b> ${escapeText(data.name)} </b>  from <b>${escapeText(view.name)} </b>` };
};

const removed = ({ A, data, previous }) => {
    const view = storedView(previous, data.id);
    if (!view) return null;
    const N = escapeText(view.name);
    return { view, message: isEmbed(view) ? `<b> ${A} </b> has deleted the  <b> Embed View ${N} </b>` : `<b> ${A} </b> has Deleted the <b> ${N} View </b>` };
};

const CHANGES = { push: added, update: renamed, delete: removed };

/* A private view is kept on the member's row, but it carries the project it was made in; the row goes there. */
const describePrivateViewChange = ({ A, operation, key, data, previous }) => {
    const change = CHANGES[operation] && CHANGES[operation]({ A, data, key, previous });
    if (!change || !OBJECT_ID.test(String(change.view.projectId || ''))) return null;
    return { projectId: String(change.view.projectId), entry: { key: HISTORY.NAME, message: change.message } };
};

const recordPrivateViewChange = async ({ companyId, uid, operation, key, data, previous }) => {
    const actor = { id: String(uid), Employee_Name: escapeText(await employeeNameOf(String(uid))) };
    const change = describePrivateViewChange({ A: actor.Employee_Name, operation, key, data, previous });
    if (!change) return;
    const access = await canReadProject(companyId, String(uid), change.projectId);
    if (!access || !access.allowed) return;
    await HandleHistory('project', companyId, change.projectId, null, change.entry, actor)
        .catch((error) => logger.error(`private view history: ${(error && error.message) || JSON.stringify(error)}`));
};

module.exports = { describePrivateViewChange, recordPrivateViewChange };
