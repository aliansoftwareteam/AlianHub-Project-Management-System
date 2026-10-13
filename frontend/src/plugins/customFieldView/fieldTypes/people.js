import { isOwnerOrAdmin } from '@/utils/roles';

const TEAM_PREFIX = 'tId_';
const SEAT_CANCELLED = 3;
const SEES_EVERY_PRIVATE_PROJECT = 2;

const isActive = (seat) => Boolean(seat && seat.userId) && seat.isDelete !== true && Number(seat.status) !== SEAT_CANCELLED;

export const activeMemberIds = (seats) => (seats || []).filter(isActive).map((seat) => String(seat.userId));

function projectPeople(project, teams) {
    const assigned = (project.AssigneeUserId || []).map(String);
    const teamIds = assigned.filter((id) => id.startsWith(TEAM_PREFIX)).map((id) => id.slice(TEAM_PREFIX.length));
    const throughTeams = (teams || []).filter((team) => teamIds.includes(String(team?._id))).flatMap((team) => (team.assigneeUsersArray || []).map(String));
    return new Set([...assigned, ...throughTeams]);
}

const seesEveryPrivateProject = (rules, roleType) => (rules?.project?.private_projects?.roles || [])
    .some((role) => role.key === roleType && role.permission === SEES_EVERY_PRIVATE_PROJECT);

/* Mirrors canReadProject on the server, which decides who may be named: the picker offers the same people, and whoever is
   already on the field stays listed so they can be taken off. */
function canOpen(project, seat, { inProject, rules }) {
    const id = String(seat.userId);
    if (project?.isPersonal === true) return String(project.personalOwner) === id;
    if (!project?.isPrivateSpace || isOwnerOrAdmin(seat.roleType)) return true;
    return inProject.has(id) || seesEveryPrivateProject(rules, seat.roleType);
}

export function peopleOptions({ project, seats, teams, rules, current }) {
    const inProject = project?.isPrivateSpace ? projectPeople(project, teams) : new Set();
    const offered = (seats || []).filter((seat) => isActive(seat) && canOpen(project, seat, { inProject, rules })).map((seat) => String(seat.userId));
    return [...new Set([...offered, ...(current || []).map(String)])];
}
