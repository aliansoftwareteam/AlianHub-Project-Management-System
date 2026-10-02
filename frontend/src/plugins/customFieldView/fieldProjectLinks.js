import { fieldProjectIds } from './taskTypeOptions';

/* The server adds and takes off a field's projects by name. A copy of the field read before someone else linked a
   project would take that project off again if it sent its whole list, so only what this change does is sent. */
export function projectLinkRequest(before, after) {
    if (after?.global === true) return { updateObject: { global: true, projectId: [] } };
    const had = fieldProjectIds(before);
    const has = fieldProjectIds(after);
    const request = { updateObject: { global: false } };
    const added = has.filter((id) => !had.includes(id));
    const takenOff = had.filter((id) => !has.includes(id));
    if (added.length) request.addProjects = added;
    if (takenOff.length) request.removeProjects = takenOff;
    return request;
}
