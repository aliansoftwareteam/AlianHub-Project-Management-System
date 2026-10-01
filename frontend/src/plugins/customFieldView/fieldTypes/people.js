const TEAM_PREFIX = 'tId_';
const SEAT_CANCELLED = 3;

export const activeMemberIds = (seats) => (seats || [])
    .filter((seat) => seat && seat.userId && seat.isDelete !== true && Number(seat.status) !== SEAT_CANCELLED)
    .map((seat) => String(seat.userId));

function projectPeople(project, teams) {
    const assigned = (project.AssigneeUserId || []).map(String);
    const teamIds = assigned.filter((id) => id.startsWith(TEAM_PREFIX)).map((id) => id.slice(TEAM_PREFIX.length));
    const throughTeams = (teams || []).filter((team) => teamIds.includes(String(team?._id))).flatMap((team) => (team.assigneeUsersArray || []).map(String));
    return new Set([...assigned, ...throughTeams]);
}

/* Who the picker offers. The server decides who may be named; this list is never wider than that, and whoever is already
   on the field stays in it so they can be taken off. */
export function peopleOptions({ project, seats, teams, current }) {
    const members = activeMemberIds(seats);
    const inProject = project?.isPrivateSpace ? projectPeople(project, teams) : null;
    const offered = inProject ? members.filter((id) => inProject.has(id)) : members;
    return [...new Set([...offered, ...(current || []).map(String)])];
}
