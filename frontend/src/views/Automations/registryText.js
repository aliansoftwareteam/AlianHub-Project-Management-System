/* The registry names its triggers and actions in English. An entry listed here is shown in the reader's
 * language, with a line of help under the builder; the rest keep the registry's own label. */
const TRIGGERS = {
    'task.due_date_passed': { label: 'Automations.trigger_due_date_passed', help: 'Automations.trigger_due_date_passed_help' },
    'task.subtasks_all_done': { label: 'Automations.trigger_subtasks_all_done', help: 'Automations.trigger_subtasks_all_done_help' },
};

const ACTIONS = {
    notify: { label: 'Automations.action_notify', help: 'Automations.action_notify_help' },
};

/* A field the builder draws with its own editor is named as that editor names it. */
const FIELDS = {
    'assign.mode': 'Automations.assign_mode',
    'assign.userIds': 'Automations.assign_people',
    'assign.roundRobin': 'Automations.assign_round_robin',
    'notify.recipients': 'Automations.notify_recipients',
    'notify.message': 'Automations.notify_message',
    'notify.includeActor': 'Automations.notify_include_actor',
};

const labelOf = (known, entry, t) => (entry && known[entry.key] ? t(known[entry.key].label) : (entry && entry.label) || '');

export const triggerLabel = (trigger, t) => labelOf(TRIGGERS, trigger, t);
export const actionLabel = (action, t) => labelOf(ACTIONS, action, t);
export const fieldLabel = (actionKey, field, schema, t) => (FIELDS[`${actionKey}.${field}`] ? t(FIELDS[`${actionKey}.${field}`]) : (schema && schema[field] && schema[field].label) || field);
export const triggerHelpKey = (key) => (TRIGGERS[key] ? TRIGGERS[key].help : '');
export const actionHelpKey = (key) => (ACTIONS[key] ? ACTIONS[key].help : '');
