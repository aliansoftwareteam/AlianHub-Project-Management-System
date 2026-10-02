const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { settingsCollectionDocs } = require('../../../Config/collections');
const { assertLocalTarget } = require('../../demo/lib/guard');
const { isScaleUser, findScaleCompany, openScaleCompany, globalFind } = require('./guard');
const { generateTasks, tally, statusesOf } = require('./generate');
const { MARK, COMPANY_NAME, PROJECT, MAX_TASKS, STATUS_COUNT, LIST_COUNT, TAGS, FIELDS, PEOPLE, listName } = require('./shape');

const BATCH_ROWS = 500;
const { ObjectId } = mongoose.Types;

const fullName = (person) => `${person.firstName} ${person.lastName}`;
const startOfDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const taskCountFrom = (value) => {
    const tasks = typeof value === 'boolean' ? NaN : Number(value);
    if (!Number.isInteger(tasks) || tasks < 1 || tasks > MAX_TASKS) throw new Error(`--tasks must be a whole number from 1 to ${MAX_TASKS}.`);
    return tasks;
};

async function seedUser({ person, companyId, adapter, created }) {
    const [existing] = await globalFind(SCHEMA_TYPE.USERS, { Employee_Email: person.email });
    if (!existing) {
        created.users += 1;
        return adapter.createUser({ person, companyId });
    }
    if (!isScaleUser(existing)) throw new Error(`${person.email} belongs to an account the scale seed did not create. It was left untouched.`);
    return String(existing._id);
}

async function memberRole(db) {
    const doc = await db.findOne(SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.ROLES });
    const role = ((doc && doc.settings) || []).find((entry) => String(entry.name).toLowerCase() === 'member');
    if (!role) throw new Error('The company role catalogue has no Member role.');
    return role.key;
}

async function seedMembers({ db, people, adapter, created }) {
    const roleType = await memberRole(db);
    const memberIds = [];
    for (const person of people) {
        const userId = await seedUser({ person, companyId: db.companyId, adapter, created });
        if (!(await db.findOne(SCHEMA_TYPE.COMPANY_USERS, { userId }))) {
            await adapter.addMember({ companyId: db.companyId, userId, email: person.email, roleType });
            created.members += 1;
        }
        memberIds.push(userId);
    }
    return memberIds;
}

async function seedLists({ db, project, owner, adapter, created }) {
    const projectId = new ObjectId(String(project._id));
    const named = async () => new Map((await db.find(SCHEMA_TYPE.SPRINTS, { projectId, deletedStatusKey: 0 })).map((list) => [list.name, list]));
    let existing = await named();
    for (let n = 0; n < LIST_COUNT; n += 1) {
        if (existing.has(listName(n))) continue;
        await adapter.createList({ companyId: db.companyId, projectId: String(project._id), projectName: project.ProjectName, name: listName(n), actor: owner });
        created.lists += 1;
    }
    existing = await named();
    return Array.from({ length: LIST_COUNT }, (_, n) => existing.get(listName(n)));
}

/* Derived from what is stored, not from the generator, so a project someone has added tasks to by hand stays consistent. */
async function writeCounters({ db, project, lists }) {
    const active = { ProjectID: new ObjectId(String(project._id)), deletedStatusKey: 0 };
    const grouped = async (field) => new Map((await db.aggregate(SCHEMA_TYPE.TASKS, [{ $match: active }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]))
        .map((row) => [String(row._id), row.n]));
    const [perList, perType] = [await grouped('sprintId'), await grouped('TaskTypeKey')];
    const total = [...perType.values()].reduce((sum, n) => sum + n, 0);
    const byId = { _id: String(project._id) };

    await db.updateOne(SCHEMA_TYPE.PROJECTS, byId, { $set: { lastTaskId: Math.max(Number(project.lastTaskId) || 0, total) } });
    for (const type of project.taskTypeCounts || []) {
        await db.updateOne(SCHEMA_TYPE.PROJECTS, byId, { $set: { 'taskTypeCounts.$[type].taskCount': perType.get(String(type.key)) || 0 } }, { arrayFilters: [{ 'type.key': type.key }] });
    }
    for (const list of lists) {
        await db.updateOne(SCHEMA_TYPE.SPRINTS, { _id: String(list._id) }, { $set: { tasks: perList.get(String(list._id)) || 0 } });
    }
    return { total, perList: Object.fromEntries(perList), perType: Object.fromEntries(perType) };
}

async function seedTasks({ db, context, tasks, log }) {
    const idsOf = async (type, filter) => new Set((await db.find(type, filter, { _id: 1 }, { lean: true })).map((row) => String(row._id)));
    const projectId = new ObjectId(String(context.project._id));
    const storedTasks = await idsOf(SCHEMA_TYPE.TASKS, { ProjectID: projectId });
    const storedComments = await idsOf(SCHEMA_TYPE.COMMENTS, { projectId });
    const missing = (docs, stored) => docs.filter((doc) => !stored.has(String(doc._id)));

    const inserted = { tasks: 0, subtasks: 0, comments: 0 };
    const generated = tally();
    let batch = [];
    const flush = async () => {
        const parents = missing(batch.map((row) => row.task), storedTasks);
        const subtasks = missing(batch.flatMap((row) => row.subtasks), storedTasks);
        const comments = missing(batch.flatMap((row) => row.comments), storedComments);
        if (parents.length + subtasks.length) await db.insertMany(SCHEMA_TYPE.TASKS, [...parents, ...subtasks]);
        if (comments.length) await db.insertMany(SCHEMA_TYPE.COMMENTS, comments);
        inserted.tasks += parents.length;
        inserted.subtasks += subtasks.length;
        inserted.comments += comments.length;
        batch = [];
    };

    for (const row of generateTasks(context, tasks)) {
        batch.push(row);
        generated.add(row);
        if (batch.length === BATCH_ROWS) {
            await flush();
            log(`  ${row.index + 1} of ${tasks} tasks`);
        }
    }
    await flush();
    return { inserted, generated: generated.counters };
}

async function seedScale({ tasks: requested, adapter = require('./adapter'), log = () => {}, now = () => new Date() } = {}) {
    assertLocalTarget(process.env);
    const tasks = taskCountFrom(requested);
    const created = { company: 0, users: 0, members: 0, project: 0, lists: 0 };
    const [ownerPerson, ...memberPeople] = PEOPLE;

    let company = await findScaleCompany();
    if (company && company.deletingAt) throw new Error('A drop of the scale seed company did not finish. Run with --drop again, then seed.');
    const ownerId = await seedUser({ person: ownerPerson, companyId: company ? String(company._id) : undefined, adapter, created });
    if (!company) {
        log(`Creating the "${COMPANY_NAME}" company`);
        await adapter.createCompany({ ownerId, email: ownerPerson.email, name: COMPANY_NAME, mark: { by: MARK, anchor: startOfDay(now()) } });
        created.company = 1;
        company = await findScaleCompany();
        if (!company) throw new Error('The company was created without its scale-seed mark; nothing else was written.');
    }
    if (String(company.userId) !== ownerId) throw new Error('The marked company is not owned by the scale seed owner. It was left untouched.');

    const db = await openScaleCompany(company._id);
    log(`Company ${db.companyId}: members`);
    const memberIds = await seedMembers({ db, people: memberPeople, adapter, created });

    let project = await db.findOne(SCHEMA_TYPE.PROJECTS, { ProjectCode: PROJECT.code });
    if (!project) {
        log(`Creating project "${PROJECT.name}"`);
        const projectId = await adapter.createProject({ companyId: db.companyId, ownerId, memberIds, project: PROJECT, tags: TAGS, fields: FIELDS });
        created.project = 1;
        project = await db.findOne(SCHEMA_TYPE.PROJECTS, { _id: projectId });
    }
    if (statusesOf(project).length !== STATUS_COUNT) throw new Error(`The project has ${statusesOf(project).length} statuses; the benchmark shape needs ${STATUS_COUNT}.`);

    const owner = { id: ownerId, Employee_Name: fullName(ownerPerson) };
    const lists = await seedLists({ db, project, owner, adapter, created });
    const fields = (await db.find(SCHEMA_TYPE.CUSTOM_FIELDS, { projectId: String(project._id) })).filter((field) => FIELDS.some((wanted) => wanted.fieldTitle === field.fieldTitle));
    if (fields.length !== FIELDS.length) throw new Error(`The project has ${fields.length} of the ${FIELDS.length} seeded custom fields; drop the company and seed again.`);

    const stored = (await db.aggregate(SCHEMA_TYPE.TASKS, [{ $match: { ProjectID: new ObjectId(String(project._id)), isParentTask: true } }, { $count: 'n' }]))[0];
    if (stored && stored.n > tasks) throw new Error(`The project already holds ${stored.n} tasks, more than the ${tasks} asked for. Run with --drop first to shrink it.`);

    log(`Tasks: ${stored ? stored.n : 0} stored, ${tasks} wanted`);
    const context = { companyId: db.companyId, project, lists, memberIds, ownerId, fields, anchor: new Date(db.company.scaleSeed.anchor) };
    const { inserted, generated } = await seedTasks({ db, context, tasks, log });
    const counters = await writeCounters({ db, project, lists });

    return { companyId: db.companyId, projectId: String(project._id), ownerId, created, inserted, generated, counters, lists: lists.map((list) => ({ id: String(list._id), name: list.name })) };
}

module.exports = { seedScale, taskCountFrom, writeCounters };
