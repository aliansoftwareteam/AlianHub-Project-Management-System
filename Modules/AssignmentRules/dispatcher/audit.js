const { recordAudit } = require('../../Audit/recorder');

const ROUTED = 'dispatcher.routed';
const SETTINGS_CHANGED = 'dispatcher.settings_changed';
const RULE_ADDED = 'dispatcher.rule_added';
const BY_PERSON = Object.freeze({
    accept: 'dispatcher.suggestion.accept',
    dismiss: 'dispatcher.suggestion.dismiss',
    route: 'dispatcher.suggestion.route',
});
const ACTOR_NAME = 'Dispatcher';

const onTask = (task) => ({ entityType: 'task', entityId: String(task._id), entityName: task.TaskName || '' });

const routed = (companyId, task, meta) => recordAudit(companyId, { actorId: '', actorName: ACTOR_NAME, action: ROUTED, ...onTask(task), meta });

const decided = (companyId, actor, action, task, meta) => recordAudit(companyId, {
    actorId: String(actor.id), actorName: actor.Employee_Name || '', action: BY_PERSON[action], ...onTask(task), meta,
});

const settingsChanged = (companyId, actor, projectId, meta, added = false) => recordAudit(companyId, {
    actorId: String(actor.id), actorName: actor.Employee_Name || '', action: added ? RULE_ADDED : SETTINGS_CHANGED, entityType: 'project', entityId: String(projectId), meta,
});

module.exports = { ROUTED, SETTINGS_CHANGED, RULE_ADDED, BY_PERSON, routed, decided, settingsChanged };
