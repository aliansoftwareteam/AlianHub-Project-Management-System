const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { readableProjects } = require('../../../Config/projectAccess');
const { readableTaskIds } = require('../../Tasks/helpers/taskWritePlacement');
const { isClosedTask } = require('../../Tasks/helpers/taskSignals');
const playbooks = require('../../Agents/rolePlaybooks');
const flag = require('./flag');
const settingsOf = require('./settings');

const STUCK_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const SHOWN = 5;
const READ = 200;
const RULE_ROWS = 500;
const AGENT_ROWS = 500;
const OPEN = 'open';
const HANDED_OVER = 'handed_over';
const WAITING_STATES = Object.freeze(['suggested', 'needs_routing']);
const TASK_FIELDS = Object.freeze({ TaskName: 1, TaskKey: 1, ProjectID: 1, updatedAt: 1, createdAt: 1, statusType: 1, status: 1, deletedStatusKey: 1, mainChat: 1 });

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const find = async (companyId, type, data) => ((await MongoDbCrudOpration(companyId, { type, data }, 'find')) || []).map(plain);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));
const teamOf = (role) => role.team || role.department;

/* The projects whose dispatcher is on with at least one role, narrowed to the ones the person may open. */
async function scope(companyId, uid) {
    const rows = await find(companyId, SCHEMA_TYPE.ASSIGNMENT_RULES, [{ dispatcher: { $exists: true } }, { projectId: 1, dispatcher: 1 }, { limit: RULE_ROWS }]);
    const active = rows.map((row) => ({ projectId: String(row.projectId), settings: settingsOf.settingsOf(row), setBy: String((row.dispatcher || {}).updatedBy || '') }))
        .filter((entry) => entry.settings.mode !== 'off' && entry.settings.roles.length);
    const { open } = await readableProjects(companyId, uid, active.map((entry) => entry.projectId), { ProjectName: 1 });
    const projects = active.filter((entry) => open.has(entry.projectId))
        .map((entry) => ({ ...entry, name: open.get(entry.projectId).ProjectName || '' }));
    return { projects, open: new Set(projects.map((entry) => entry.projectId)) };
}

const namesOf = async (userIds) => {
    const ids = [...new Set(userIds)].filter(isId);
    if (!ids.length) return new Map();
    const rows = await find(dbCollections.GLOBAL, SCHEMA_TYPE.USERS, [{ _id: { $in: ids.map(oid) } }, { Employee_Name: 1 }]);
    return new Map(rows.map((row) => [String(row._id), row.Employee_Name || '']));
};

const rolesOn = (projects) => {
    const byRole = new Map();
    projects.forEach((project) => project.settings.roles.forEach((key) => {
        if (!settingsOf.roleOf(key)) return;
        byRole.set(key, [...(byRole.get(key) || []), project]);
    }));
    return byRole;
};

const agentsOf = async (companyId, roleKeys, open) => (roleKeys.length
    ? (await find(companyId, SCHEMA_TYPE.AGENTS, [{ role: { $in: roleKeys }, deletedStatusKey: { $ne: 1 } }, { name: 1, role: 1, projectIds: 1, paused: 1, ownerId: 1 }, { limit: AGENT_ROWS }]))
        .filter((agent) => !(agent.projectIds || []).length || agent.projectIds.map(String).some((id) => open.has(id)))
    : []);

/* The person who supervises a role is the owner of the agents that play it; a role with no agent yet is supervised by
 * whoever last saved the dispatcher settings that switched it on. */
const supervisorsOf = (agents, projects, names) => {
    const owners = [...new Set(agents.map((agent) => String(agent.ownerId || '')).filter(Boolean))];
    if (owners.length) return owners.map((id) => ({ id, name: names.get(id) || '', via: 'agent' }));
    const setBy = [...new Set(projects.map((project) => project.setBy).filter(Boolean))];
    return setBy.map((id) => ({ id, name: names.get(id) || '', via: 'settings' }));
};

async function orgChart(companyId, uid) {
    if (!flag.enabled()) return { on: false, blueprints: [] };
    const { projects, open } = await scope(companyId, uid);
    const byRole = rolesOn(projects);
    const agents = await agentsOf(companyId, [...byRole.keys()], open);
    const agentsByRole = new Map();
    agents.forEach((agent) => agentsByRole.set(agent.role, [...(agentsByRole.get(agent.role) || []), agent]));
    const names = await namesOf([...agents.map((agent) => agent.ownerId), ...projects.map((project) => project.setBy)].map(String));

    const blueprints = new Map();
    playbooks.all().filter((role) => byRole.has(settingsOf.roleKey(role))).forEach((role) => {
        const key = settingsOf.roleKey(role);
        const theirs = agentsByRole.get(key) || [];
        const entry = {
            key,
            name: role.name,
            projects: byRole.get(key).map((project) => ({ id: project.projectId, name: project.name, mode: project.settings.mode })),
            agents: theirs.map((agent) => ({ id: String(agent._id), name: agent.name || '', paused: agent.paused === true })),
            supervisors: supervisorsOf(theirs, byRole.get(key), names),
        };
        const teams = blueprints.get(role.blueprint) || new Map();
        teams.set(teamOf(role), [...(teams.get(teamOf(role)) || []), entry]);
        blueprints.set(role.blueprint, teams);
    });
    return {
        on: true,
        blueprints: [...blueprints].map(([blueprint, teams]) => ({
            blueprint,
            teams: [...teams].map(([team, roles]) => ({ team, roles })),
        })),
    };
}

const liveClaim = (row, now) => Boolean(row.claim && new Date(row.claim.until).getTime() > now.getTime());

async function readTasks(companyId, uid, taskIds) {
    const ids = [...new Set(taskIds.map(String))].filter(isId);
    if (!ids.length) return new Map();
    const [visible, rows] = await Promise.all([
        readableTaskIds(companyId, uid, ids),
        find(companyId, SCHEMA_TYPE.TASKS, [{ _id: { $in: ids.map(oid) }, deletedStatusKey: { $ne: 1 } }, TASK_FIELDS]),
    ]);
    const seen = new Set(visible.map(String));
    return new Map(rows.filter((task) => task.mainChat !== true && seen.has(String(task._id)) && !isClosedTask(task)).map((task) => [String(task._id), task]));
}

const lane = () => ({ count: 0, items: [] });
const add = (target, item) => {
    target.count += 1;
    if (target.items.length < SHOWN) target.items.push(item);
};

async function flowBoard(companyId, uid, now = new Date()) {
    if (!flag.enabled()) return { on: false, stuckDays: STUCK_DAYS, unrouted: lane(), roles: [] };
    const { projects, open } = await scope(companyId, uid);
    const byRole = rolesOn(projects);
    const projectName = new Map(projects.map((project) => [project.projectId, project.name]));
    const roleIn = new Map(projects.map((project) => [project.projectId, new Set(project.settings.roles)]));
    const ids = [...open];
    const [decisions, rows] = ids.length ? await Promise.all([
        find(companyId, SCHEMA_TYPE.DISPATCH_DECISIONS, [{ projectId: { $in: ids }, state: { $in: WAITING_STATES } }, null, { sort: { createdAt: -1 }, limit: READ }]),
        find(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [
            { rule: HANDED_OVER, status: OPEN, leftQueue: null, 'facts.role': { $in: [...byRole.keys()] }, projectId: { $in: idForms(ids) } }, {}, { sort: { openedAt: 1 }, limit: READ },
        ]),
    ]) : [[], []];
    const tasks = await readTasks(companyId, uid, [...decisions.map((decision) => decision.taskId), ...rows.map((row) => row.taskId)]);

    const lanes = new Map([...byRole.keys()].map((key) => [key, { key, name: settingsOf.roleName(key), waiting: lane(), queued: lane(), held: lane(), stuck: lane() }]));
    const unrouted = lane();
    const item = (task, projectId, more = {}) => ({ taskId: String(task._id), taskKey: task.TaskKey || '', taskName: task.TaskName || '', projectId, project: projectName.get(projectId) || '', ...more });

    decisions.forEach((decision) => {
        const task = tasks.get(String(decision.taskId));
        if (!task || String(task.ProjectID) !== String(decision.projectId)) return;
        const projectId = String(decision.projectId);
        if (decision.state === 'needs_routing') return add(unrouted, item(task, projectId));
        const target = lanes.get(decision.role);
        if (target && roleIn.get(projectId).has(decision.role)) add(target.waiting, item(task, projectId, { source: decision.source || '' }));
        return undefined;
    });

    rows.forEach((row) => {
        const role = row.facts && row.facts.role;
        const projectId = String(row.projectId);
        const task = tasks.get(String(row.taskId));
        const target = lanes.get(role);
        if (!task || !target || String(task.ProjectID) !== projectId || !roleIn.get(projectId).has(role)) return;
        const lastActive = new Date(task.updatedAt || task.createdAt || row.openedAt).getTime();
        const stuck = now.getTime() - lastActive > STUCK_DAYS * DAY_MS;
        const why = row.proposalId ? 'approval' : (liveClaim(row, now) ? 'claimed' : '');
        const entry = item(task, projectId, { why, stuck });
        add(why ? target.held : target.queued, entry);
        if (stuck) add(target.stuck, entry);
    });

    const order = new Map(playbooks.all().map((role, index) => [settingsOf.roleKey(role), index]));
    return { on: true, stuckDays: STUCK_DAYS, unrouted, roles: [...lanes.values()].sort((a, b) => order.get(a.key) - order.get(b.key)) };
}

module.exports = { STUCK_DAYS, orgChart, flowBoard };
