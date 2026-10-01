/* The registry names its triggers and actions in English. An entry listed here is shown in the reader's
 * language, with a line of help under the builder; the rest keep the registry's own label. */
const TRIGGERS = {
    'task.due_date_passed': { label: 'Automations.trigger_due_date_passed', help: 'Automations.trigger_due_date_passed_help' },
    'task.subtasks_all_done': { label: 'Automations.trigger_subtasks_all_done', help: 'Automations.trigger_subtasks_all_done_help' },
};

const ACTIONS = {
    notify: { label: 'Automations.action_notify', help: 'Automations.action_notify_help' },
};

const labelOf = (known, entry, t) => (entry && known[entry.key] ? t(known[entry.key].label) : (entry && entry.label) || '');

export const triggerLabel = (trigger, t) => labelOf(TRIGGERS, trigger, t);
export const actionLabel = (action, t) => labelOf(ACTIONS, action, t);
export const triggerHelpKey = (key) => (TRIGGERS[key] ? TRIGGERS[key].help : '');
export const actionHelpKey = (key) => (ACTIONS[key] ? ACTIONS[key].help : '');
