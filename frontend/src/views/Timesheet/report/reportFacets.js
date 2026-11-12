// CommonJS so the server-side jest suite tests it.

const MATCH = Object.freeze(['any', 'all']);

/* A project counts for a person when they are on it (directly or through a team) or logged or planned time in it. */
const projectsOfPerson = (uid, { projects = [], workedByUser = {}, teamsOfUser = {} }) => {
    const teams = (teamsOfUser[uid] || []).map((id) => `tId_${id}`);
    const ids = new Set((workedByUser[uid] || []).map(String));
    projects.forEach((project) => {
        const people = project.AssigneeUserId || [];
        if (people.includes(uid) || teams.some((team) => people.includes(team))) ids.add(String(project._id));
    });
    return ids;
};

/* The projects the chosen people share: any of them (union) or all of them (intersection). null when no one is chosen. */
const projectsForPeople = ({ people = [], match = 'any', ...data }) => {
    if (!people.length) return null;
    const sets = people.map((uid) => projectsOfPerson(String(uid), data));
    if (match === 'all') return sets.reduce((shared, set) => new Set([...shared].filter((id) => set.has(id))));
    return sets.reduce((all, set) => new Set([...all, ...set]), new Set());
};

/* Which projects the other filters take their options from: the chosen projects, else the people's, else every one. */
const basisProjects = ({ chosen = [], allowed = null, all = [] }) => {
    if (chosen.length) return all.filter((project) => chosen.includes(String(project._id)));
    if (allowed) return all.filter((project) => allowed.has(String(project._id)));
    return all;
};

/* Options narrowed to a set, keeping anything already picked so it can still be cleared. */
const keepAllowed = (options, allowedValues, picked = []) => (allowedValues
    ? options.filter((option) => allowedValues.has(option.value) || picked.includes(option.value))
    : options);

/* The chosen options first, in the order shown, then the rest. */
const pickedFirst = (options, picked = []) => [...options.filter((o) => picked.includes(o.value)), ...options.filter((o) => !picked.includes(o.value))];

/* Teams as People filter groups. Members are kept to the people the filter lists, so a team never picks someone
 * who has left; a team with none of them is not offered. */
const teamOptions = (teams = [], people = []) => {
    const listed = new Set(people.map((option) => option.value));
    return teams
        .map((team) => ({
            value: String(team._id),
            label: team.name || '',
            color: (team.teamColor && team.teamColor.bgColor) || '',
            members: [...new Set((team.assigneeUsersArray || []).map(String))].filter((uid) => listed.has(uid)),
        }))
        .filter((team) => team.label && team.members.length)
        .sort((a, b) => a.label.localeCompare(b.label));
};

module.exports = { MATCH, projectsOfPerson, projectsForPeople, basisProjects, keepAllowed, pickedFirst, teamOptions };
