import { peopleOptions } from '@/plugins/customFieldView/fieldTypes/people';

/* The server refuses a copy that names anyone who cannot open the project it lands in, so a copy brings along
   only those of the task's people who can, and of them only the people of the list when the list is private. */
export function peopleCarried(ids, { project, sprint, seats, teams, rules }) {
    const mayOpen = new Set(peopleOptions({ project, seats, teams, rules }));
    const onList = sprint?.private === true ? new Set((sprint.AssigneeUserId || []).map(String)) : null;
    return (ids || []).map(String).filter((id) => mayOpen.has(id) && (!onList || onList.has(id)));
}
