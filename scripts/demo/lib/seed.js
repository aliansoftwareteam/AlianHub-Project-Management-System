const crypto = require('crypto');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections, settingsCollectionDocs } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { assertLocalTarget } = require('./guard');
const { readAccounts, writeAccounts, companyEntry, accountFor, upsertAccount, track } = require('./accounts');
const { OBJECT_ID } = require('./ids');
const { PEOPLE, PROJECT, TASKS, AGENTS } = require('./team');

const GLOBAL = dbCollections.GLOBAL;
// What an invite stores when nobody picks a designation; used when the company catalogue has no match.
const UNSET_DESIGNATION = 0;

const findOne = (db, type, filter) => MongoDbCrudOpration(db, { type, data: [filter] }, 'findOne');
const find = async (db, type, filter) => (await MongoDbCrudOpration(db, { type, data: [filter] }, 'find')) || [];
const randomPassword = () => crypto.randomBytes(18).toString('base64url');
const fullName = (person) => `${person.firstName} ${person.lastName}`;
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

async function resolveCompany(requested) {
    if (requested !== undefined) {
        if (!OBJECT_ID.test(String(requested))) throw new Error('--company must be a 24-character company id.');
        const company = await findOne(GLOBAL, SCHEMA_TYPE.COMPANIES, { _id: String(requested) });
        if (!company) throw new Error(`Company ${requested} was not found.`);
        return company;
    }
    const companies = await find(GLOBAL, SCHEMA_TYPE.COMPANIES, {});
    if (companies.length !== 1) throw new Error(`Found ${companies.length} companies; pass --company <id> to choose one.`);
    return companies[0];
}

async function resolveRoles(companyId) {
    const doc = await findOne(companyId, SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.ROLES });
    const catalogue = doc && Array.isArray(doc.settings) ? doc.settings : [];
    const named = (name) => catalogue.find((role) => sameName(role.name, name));
    const admin = named('Admin');
    const member = named('Member');
    if (!admin || !member) throw new Error('The company role catalogue has no Admin or Member role.');
    return { admin, member, restricted: named('Guest') || member };
}

async function designationResolver(companyId) {
    const doc = await findOne(companyId, SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.DESIGNATIONS });
    const catalogue = doc && Array.isArray(doc.settings) ? doc.settings : [];
    return (person) => {
        for (const name of person.designations) {
            const hit = catalogue.find((designation) => sameName(designation.name, name));
            if (hit) return hit.key;
        }
        return UNSET_DESIGNATION;
    };
}

async function seedPerson({ companyId, entry, person, role, designation, adapter, created, warnings, save }) {
    const existing = await findOne(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: person.email });
    if (existing && existing.demo !== true) {
        warnings.push(`${person.email} belongs to an account the seed did not create; it was left untouched.`);
        return null;
    }
    if (existing && !(existing.AssignCompany || []).map(String).includes(companyId)) {
        warnings.push(`${person.email} is a demo account of another company; it was left untouched.`);
        return null;
    }

    const account = { email: person.email, name: fullName(person), title: person.title, role: role.name, roleType: role.key };
    let userId;
    if (existing) {
        userId = String(existing._id);
        if (!accountFor(entry, person.email)) {
            upsertAccount(entry, { ...account, userId, password: null });
            warnings.push(`${person.email} exists but its password is not in the credentials file; run demo:unseed then demo:seed to reset it.`);
        }
    } else {
        const password = randomPassword();
        userId = String(await adapter.createUser({ companyId, person, password }));
        upsertAccount(entry, { ...account, userId, password });
        created.users += 1;
    }
    track(entry, 'users', userId);
    track(entry, 'userAuth', userId);
    save();

    const membership = await findOne(companyId, SCHEMA_TYPE.COMPANY_USERS, { userId });
    if (membership && membership.demo !== true) {
        warnings.push(`${person.email} has a company membership the seed did not create; it was left untouched.`);
        return null;
    }
    if (!membership) {
        const ids = await adapter.addMember({ companyId, userId, email: person.email, roleType: role.key, designation });
        track(entry, 'companyUsers', ids.companyUserId);
        track(entry, 'userIdCounts', ids.userIdCountId);
        track(entry, 'notificationSettings', ids.notificationSettingsId);
        created.members += 1;
        save();
    }
    return { ...person, userId, role };
}

async function seedDemoTeam({ company, accountsPath, adapter = require('./appAdapter') } = {}) {
    assertLocalTarget(process.env);
    const startedAt = new Date();
    const companyDoc = await resolveCompany(company);
    const companyId = String(companyDoc._id);
    const ownerId = String(companyDoc.userId || '');
    const roles = await resolveRoles(companyId);
    const designationOf = await designationResolver(companyId);

    const accounts = readAccounts(accountsPath);
    const entry = companyEntry(accounts, companyId);
    const save = () => writeAccounts(accountsPath, accounts);
    const created = { users: 0, members: 0, projects: 0, sprints: 0, tasks: 0, agents: 0 };
    const warnings = [];

    const team = {};
    for (const person of PEOPLE) {
        const seeded = await seedPerson({
            companyId, entry, person, role: roles[person.role], designation: designationOf(person), adapter, created, warnings, save,
        });
        if (seeded) team[person.key] = seeded;
    }
    if (Object.keys(team).length !== PEOPLE.length) {
        throw new Error(`Stopped before creating the project. ${warnings.join(' ')}`);
    }

    const lead = team[PROJECT.lead];
    const actor = { id: lead.userId, Employee_Name: fullName(lead) };
    const inProject = (projectId, rows, field) => rows.filter((row) => String(row[field]) === projectId);

    let project = await findOne(companyId, SCHEMA_TYPE.PROJECTS, { ProjectName: PROJECT.name, demo: true, deletedStatusKey: { $ne: 1 } });
    if (!project) {
        const out = await adapter.createProject({
            companyId, creatorId: lead.userId, memberIds: PEOPLE.map((person) => team[person.key].userId), project: PROJECT,
        });
        track(entry, 'projects', out.projectId);
        created.projects += 1;
        if (out.listSprintId) {
            track(entry, 'sprints', out.listSprintId);
            created.sprints += 1;
        }
        save();
        project = await findOne(companyId, SCHEMA_TYPE.PROJECTS, { _id: String(out.projectId) });
    }
    const projectId = String(project._id);
    track(entry, 'projects', projectId);

    let [sprint] = inProject(projectId, await find(companyId, SCHEMA_TYPE.SPRINTS, { name: PROJECT.sprint.name, demo: true, deletedStatusKey: { $ne: 1 } }), 'projectId');
    if (!sprint) {
        const sprintId = await adapter.createSprint({ companyId, projectId, projectName: project.ProjectName, actor, sprint: PROJECT.sprint });
        track(entry, 'sprints', sprintId);
        created.sprints += 1;
        save();
        sprint = await findOne(companyId, SCHEMA_TYPE.SPRINTS, { _id: String(sprintId) });
    }

    const taskNames = new Set(inProject(projectId, await find(companyId, SCHEMA_TYPE.TASKS, { demo: true, deletedStatusKey: { $ne: 1 } }), 'ProjectID').map((task) => task.TaskName));
    for (const task of TASKS) {
        if (taskNames.has(task.name)) continue;
        const taskId = await adapter.createTask({
            companyId,
            project,
            sprint,
            actor,
            ownerId,
            task,
            leaderId: team[task.leader].userId,
            assigneeIds: task.assignees.map((key) => team[key].userId),
        });
        track(entry, 'tasks', taskId);
        created.tasks += 1;
        save();
    }

    if (['', 'planned'].includes(String(sprint.state || ''))) {
        await adapter.startSprint({ companyId, sprintId: String(sprint._id), actorId: lead.userId });
    }

    const agentNames = new Set((await find(companyId, SCHEMA_TYPE.AGENTS, { demo: true, deletedStatusKey: { $ne: 1 } }))
        .filter((agent) => (agent.projectIds || []).map(String).includes(projectId))
        .map((agent) => agent.name));
    for (const agent of AGENTS) {
        if (agentNames.has(agent.name)) continue;
        const out = await adapter.createAgent({ companyId, projectId, ownerId: lead.userId, agent });
        track(entry, 'agents', out.agentId);
        track(entry, 'agentRevisions', out.revisionIds);
        created.agents += 1;
        save();
    }

    if (created.projects || created.sprints || created.tasks) {
        const side = await adapter.collectSideRecords({ companyId, projectId, since: startedAt });
        Object.entries(side || {}).forEach(([key, ids]) => track(entry, key, ids));
    }
    save();

    return {
        companyId,
        companyName: companyDoc.Cst_CompanyName || '',
        projectId,
        sprintName: PROJECT.sprint.name,
        created,
        warnings,
        team: PEOPLE.map((person) => ({
            name: fullName(person),
            title: person.title,
            email: person.email,
            role: roles[person.role].name,
            roleType: roles[person.role].key,
        })),
    };
}

module.exports = { seedDemoTeam };
