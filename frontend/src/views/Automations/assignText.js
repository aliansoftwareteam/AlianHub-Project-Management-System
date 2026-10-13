const ROLE_KEYS = {
    task_creator: 'Automations.assign_task_creator',
    form_submitter: 'Automations.assign_form_submitter',
    task_assignees: 'Automations.notify_role_task_assignees',
    task_watchers: 'Automations.notify_role_task_watchers',
};

const nameOf = (person, t) => person.name || t(ROLE_KEYS[person.userId] || 'Automations.assign_unknown_person');

export const assignPeopleText = (people, t) => (people || []).map((person) => nameOf(person, t)).join(', ');

export const assignSkippedText = (skipped, t) => t('Automations.assign_skipped', {
    people: (skipped || []).map((person) => `${nameOf(person, t)} (${t(`Automations.assign_skip_${person.reason}`)})`).join(', '),
});
