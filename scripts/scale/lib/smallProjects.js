const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { assertLocalTarget } = require('../../demo/lib/guard');
const { isScaleUser, findScaleCompany, openScaleCompany, globalFind } = require('./guard');
const { generateTasks, objectIdFor, MAX_SUBTASKS } = require('./generate');
const { writeCounters } = require('./seed');
const { PROJECT, PEOPLE, TAGS, SMALL_PROJECTS, smallProject } = require('./shape');

const { ObjectId } = mongoose.Types;
const STAGGER_MS = 7 * 60 * 1000;

const projectCountFrom = (value) => {
    const count = typeof value === 'boolean' ? NaN : Number(value);
    if (!Number.isInteger(count) || count < 1 || count > SMALL_PROJECTS.max) throw new Error(`--small-projects must be a whole number from 1 to ${SMALL_PROJECTS.max}.`);
    return count;
};

/* The generator numbers its documents from the creation time and the task number alone, so the same ten tasks in
 * every small project would share ids with each other and with the big project's first ten. Each small project gets
 * its own id range and its own slice of time, which also keeps the tasks of different projects from tying on
 * `updatedAt`. The ids stay the same on every run, so a second run recognises what is stored. */
function ownTasks(rows, number) {
    return rows.flatMap(({ index, task, subtasks }) => {
        const shift = (date) => new Date(date.getTime() + number * STAGGER_MS);
        const slot = number * SMALL_PROJECTS.tasks + index;
        const at = shift(task.createdAt);
        const parent = { ...task, _id: objectIdFor('smallTask', at, slot), createdAt: at, updatedAt: at };
        delete parent.lastMessage;
        delete parent.message;
        const children = subtasks.map((subtask, n) => {
            const subAt = shift(subtask.createdAt);
            return { ...subtask, _id: objectIdFor('smallSubtask', subAt, slot * (MAX_SUBTASKS + 1) + n), ParentTaskId: String(parent._id), createdAt: subAt, updatedAt: subAt };
        });
        return [parent, ...children];
    });
}

async function ensureList({ db, project, owner, adapter, created }) {
    const projectId = new ObjectId(String(project._id));
    const stored = async () => (await db.find(SCHEMA_TYPE.SPRINTS, { projectId, deletedStatusKey: 0 })).find((list) => list.name === SMALL_PROJECTS.list);
    const existing = await stored();
    if (existing) return existing;
    await adapter.createList({ companyId: db.companyId, projectId: String(project._id), projectName: project.ProjectName, name: SMALL_PROJECTS.list, actor: owner });
    created.lists += 1;
    return stored();
}

/* Adds `count` small projects to the scale seed company and nothing anywhere else. It needs the company and its big
 * project to exist; `--drop` removes these with the rest of the company's database. Running it again with the same or
 * a larger count creates only what is missing. */
async function seedSmallProjects({ count: requested, adapter = require('./adapter'), log = () => {} } = {}) {
    assertLocalTarget(process.env);
    const count = projectCountFrom(requested);
    const company = await findScaleCompany();
    if (!company) throw new Error('There is no scale seed company. Seed it with --tasks first.');
    if (company.deletingAt) throw new Error('A drop of the scale seed company did not finish. Run with --drop again, then seed.');
    const db = await openScaleCompany(company._id);
    const main = await db.findOne(SCHEMA_TYPE.PROJECTS, { ProjectCode: PROJECT.code });
    if (!main) throw new Error('The scale seed company has no project yet. Seed it with --tasks first.');

    const [ownerUser] = await globalFind(SCHEMA_TYPE.USERS, { Employee_Email: PEOPLE[0].email });
    if (!isScaleUser(ownerUser)) throw new Error('The scale seed owner is missing. Nothing was written.');
    const ownerId = String(ownerUser._id);
    const owner = { id: ownerId, Employee_Name: `${PEOPLE[0].firstName} ${PEOPLE[0].lastName}` };
    const memberIds = (await db.find(SCHEMA_TYPE.COMPANY_USERS, {})).map((member) => String(member.userId)).filter((id) => id !== ownerId);

    const created = { projects: 0, lists: 0 };
    const inserted = { tasks: 0, subtasks: 0 };
    for (let number = 1; number <= count; number += 1) {
        const shape = smallProject(number);
        let project = await db.findOne(SCHEMA_TYPE.PROJECTS, { ProjectCode: shape.code });
        if (!project) {
            // Only the owner is put on it: thirty people on hundreds of projects would write thousands of notices nobody reads.
            const projectId = await adapter.createProject({ companyId: db.companyId, ownerId, memberIds: [], project: shape, tags: TAGS, fields: [] });
            created.projects += 1;
            project = await db.findOne(SCHEMA_TYPE.PROJECTS, { _id: projectId });
        }
        const list = await ensureList({ db, project, owner, adapter, created });
        const context = { companyId: db.companyId, project, lists: [list], memberIds, ownerId, fields: [], anchor: new Date(db.company.scaleSeed.anchor) };
        const docs = ownTasks([...generateTasks(context, SMALL_PROJECTS.tasks)], number);
        const stored = new Set((await db.find(SCHEMA_TYPE.TASKS, { ProjectID: new ObjectId(String(project._id)) }, { _id: 1 }, { lean: true })).map((row) => String(row._id)));
        const missing = docs.filter((doc) => !stored.has(String(doc._id)));
        if (missing.length) {
            await db.insertMany(SCHEMA_TYPE.TASKS, missing);
            inserted.tasks += missing.filter((doc) => doc.isParentTask).length;
            inserted.subtasks += missing.filter((doc) => !doc.isParentTask).length;
            await writeCounters({ db, project, lists: [list] });
        }
        if (number % 25 === 0 || number === count) log(`  ${number} of ${count} small projects`);
    }

    const projects = (await db.find(SCHEMA_TYPE.PROJECTS, {})).filter((project) => /^SS\d{3}$/.test(String(project.ProjectCode)));
    return { companyId: db.companyId, created, inserted, stored: { smallProjects: projects.length } };
}

module.exports = { seedSmallProjects, projectCountFrom, ownTasks };
