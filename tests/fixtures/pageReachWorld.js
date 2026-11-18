// One small workspace every page reader is asked about, so their answers can be compared.

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER } = require('../../Config/roleTypes');

const C = 'c000000000000000000000c1';

const PEOPLE = {
    owner: 'a000000000000000000000a1',
    admin: 'a000000000000000000000a2',
    inside: 'a000000000000000000000a3',
    outside: 'a000000000000000000000a4',
    guest: 'a000000000000000000000a5',
    viewer: 'a000000000000000000000a6',
    editor: 'a000000000000000000000a7',
};

const ROLES = { owner: ROLE_OWNER, admin: ROLE_ADMIN, inside: ROLE_MEMBER, outside: ROLE_MEMBER, guest: ROLE_GUEST, viewer: ROLE_MEMBER, editor: ROLE_MEMBER };

const PROJECTS = {
    open: 'b000000000000000000000b1',
    closed: 'b000000000000000000000b2',
    trashed: 'b000000000000000000000b3',
};

const TASK = 'd000000000000000000000d1';

const PAGES = {
    insidePrivate: 'e000000000000000000000e1',
    outsidePrivate: 'e000000000000000000000e2',
    shared: 'e000000000000000000000e3',
    company: 'e000000000000000000000e4',
    closed: 'e000000000000000000000e5',
    orphaned: 'e000000000000000000000e6',
    deleted: 'e000000000000000000000e7',
    namedView: 'e000000000000000000000e8',
    namedEdit: 'e000000000000000000000e9',
};

const SHARED_AT = new Date(Date.UTC(2026, 0, 20));
const namedTo = (who, role, by) => [{ userId: PEOPLE[who], role, by: PEOPLE[by], at: SHARED_AT }];

const pageRows = () => [
    { _id: PAGES.insidePrivate, visibility: 'private', createdBy: PEOPLE.inside, ProjectID: PROJECTS.open },
    { _id: PAGES.outsidePrivate, visibility: 'private', createdBy: PEOPLE.outside, ProjectID: PROJECTS.open },
    { _id: PAGES.shared, visibility: 'project', createdBy: PEOPLE.owner, ProjectID: PROJECTS.open },
    { _id: PAGES.company, visibility: 'project', createdBy: PEOPLE.owner },
    { _id: PAGES.closed, visibility: 'project', createdBy: PEOPLE.owner, ProjectID: PROJECTS.closed },
    { _id: PAGES.orphaned, visibility: 'project', createdBy: PEOPLE.owner, ProjectID: PROJECTS.trashed },
    { _id: PAGES.deleted, visibility: 'project', createdBy: PEOPLE.owner, ProjectID: PROJECTS.open, deletedStatusKey: 1 },
    { _id: PAGES.namedView, visibility: 'private', createdBy: PEOPLE.inside, ProjectID: PROJECTS.closed, sharedWith: namedTo('viewer', 'viewer', 'inside') },
    { _id: PAGES.namedEdit, visibility: 'project', createdBy: PEOPLE.owner, ProjectID: PROJECTS.closed, sharedWith: namedTo('editor', 'editor', 'owner') },
].map((row, index) => ({
    title: `Atlas ${nameOf(row._id)}`,
    rawText: 'atlas notes',
    updatedBy: row.createdBy,
    deletedStatusKey: 0,
    order: index,
    linkedTasks: [TASK],
    updatedAt: new Date(Date.UTC(2026, 0, 1 + index)),
    ...row,
}));

const nameOf = (id) => Object.keys(PAGES).find((name) => PAGES[name] === String(id)) || String(id);

const nameOfPerson = (id) => Object.keys(PEOPLE).find((who) => PEOPLE[who] === String(id)) || String(id);

/* The pages a reader answered with, by name and in the world's own order. */
const named = (rows) => {
    const ids = new Set((rows || []).map((row) => String((row && (row._id || row.id || row.pageId || row.sourceId)) || row)));
    return Object.keys(PAGES).filter((name) => ids.has(PAGES[name]));
};

const seed = (db) => {
    Object.keys(PEOPLE).forEach((who) => db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: PEOPLE[who], roleType: ROLES[who], status: 2, isDelete: false }));
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECTS.open, ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECTS.closed, ProjectName: 'Closed', isPrivateSpace: true, AssigneeUserId: [PEOPLE.inside], deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECTS.trashed, ProjectName: 'Trashed', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 1 });
    db.seed(SCHEMA_TYPE.TASKS, { _id: TASK, TaskName: 'Atlas task', TaskKey: 'AT-1', ProjectID: PROJECTS.open, deletedStatusKey: 0, AssigneeUserId: [] });
    pageRows().forEach((row) => db.seed(SCHEMA_TYPE.PAGES, row));
};

/* Runs `read` as each person and answers { person: [page names] }. */
const askEveryone = async (read) => {
    const answers = {};
    for (const who of Object.keys(PEOPLE)) {
        answers[who] = named(await read(PEOPLE[who], who));
    }
    return answers;
};

module.exports = { C, PEOPLE, ROLES, PROJECTS, PAGES, TASK, pageRows, nameOf, nameOfPerson, named, seed, askEveryone };
