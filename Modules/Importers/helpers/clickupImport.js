/* The reads and writes around a ClickUp import's plan: who may be named, which fields the project has, the definitions
 * the plan creates, and the comments and links written once the tasks exist. */
const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const { canEditProject, canReadProject } = require('../../../Config/projectAccess');
const { fieldInsertFrom } = require('../../CustomField/helpers/fieldWrite');
const { isTaskFieldOf } = require('../../CustomField/helpers/fieldValueInput');
const { recordFieldCreated } = require('../../CustomField/helpers/customFieldHistory');
const { escapeCommentText } = require('../../Comments/helpers/plainText');
const { findCompanyMembers } = require('./companyMembers');
const { transformClickUpRows } = require('./clickupRules');
const { fieldDefinitionFrom, namedPeople } = require('./clickupFields');
const { planClickUpList, stateAfter, mergeSummaries, fieldsSummary } = require('./clickupPlan');

// The keys the web app checks before it offers the field form and the comment box.
const FIELD_EDIT = [['project.project_custom_field', 'task.task_custom_field']];
const COMMENT = ['task.task_comment'];
const EVERYTHING = Object.freeze({ fields: true, comments: true });
const LINK_KIND = 'link';
const LINKS_HEADING = 'Attachments in ClickUp:';
const MAX_COMMENT_LENGTH = 10000;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const lower = (value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase();
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const failed = (what) => (error) => logger.error(`[importers] ${what}: ${(error && error.message) || error}`);

const detailsAccess = async (companyId, uid, projectId) => {
    const [fields, comments] = await Promise.all([
        canEditProject(companyId, uid, projectId, FIELD_EDIT),
        canEditProject(companyId, uid, projectId, COMMENT),
    ]);
    return { fields: fields.allowed === true, comments: comments.allowed === true };
};

/* Each email the file names, as a member of the company and as a member who can open the project. A project that does
 * not exist yet has no one it hides from. */
const peopleDirectory = async (companyId, projectId, emails) => {
    const wanted = [...new Set(emails.map(lower).filter((email) => email.includes('@')))];
    const members = wanted.length
        ? await findCompanyMembers(companyId, { Employee_Email: { $in: wanted } }, { _id: 1, Employee_Email: 1 })
        : [];
    const memberIdByEmail = new Map(members.map((member) => [lower(member.Employee_Email), String(member._id)]));
    const openIdByEmail = new Map();
    for (const [email, id] of memberIdByEmail) {
        if (!projectId || (await canReadProject(companyId, id, projectId)).allowed) openIdByEmail.set(email, id);
    }
    return { memberIdByEmail, openIdByEmail };
};

const emailsNamedIn = (columns, tasks) => [
    ...tasks.flatMap((task) => task.memberEmails || []),
    ...tasks.flatMap((task) => (task.comments || []).map((comment) => comment.email)),
    ...namedPeople(columns, tasks),
];

const projectFieldDefinitions = async (companyId, projectId) => {
    const found = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ type: 'task' }] }, 'find');
    return (found || []).map(plain).filter((definition) => isTaskFieldOf(definition, projectId)).map((definition) => ({ ...definition, _id: String(definition._id) }));
};

const tagNamesOf = (project) => ((project && project.tagsArray) || []).map((tag) => tag && tag.tagName).filter(Boolean);

const dropColumn = (column) => Object.assign(column, { action: 'skipped', reason: 'failed', dropped: column.dropped + column.set, set: 0 });

/* Saves the definitions the plan creates and the options it adds, then puts each value on its task under the id of
 * its field. A definition that could not be saved takes its column's values with it, and the summary says so. */
const saveFieldPlan = async (companyId, { fieldPlan, projectId, actorId }) => {
    // Required here: the field controller pulls in the formula engine.
    const { insertCustomFieldPromise } = require('../../CustomField/controller');
    for (const column of fieldPlan.columns) {
        try {
            if (column.action === 'create') {
                const saved = plain(await insertCustomFieldPromise(fieldInsertFrom(fieldDefinitionFrom(column.definition, { projectId, userId: actorId })), 'save', companyId));
                column.definition = { ...column.definition, _id: String(saved._id) };
                recordFieldCreated({ companyId, field: saved, actorId }).catch(failed('field history'));
            } else if (column.action === 'reuse' && column.addedOptions.length) {
                await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.CUSTOM_FIELDS,
                    data: [{ _id: oid(column.definition._id) }, { $set: { fieldOptions: column.definition.fieldOptions, updatedAt: new Date() } }],
                }, 'updateOne');
                removeCache(`customField:${companyId}`);
            }
        } catch (error) {
            failed(`field "${column.name}" not saved`)(error);
            dropColumn(column);
        }
    }
    fieldPlan.values.forEach((entries, task) => {
        const held = entries.filter(({ column }) => ['create', 'reuse'].includes(column.action));
        if (held.length) task.customField = Object.fromEntries(held.map(({ column, detail }) => [String(column.definition._id), { ...detail, _id: String(column.definition._id) }]));
    });
};

/* The attachment links of each created task. Nothing is fetched: the link points at the file where ClickUp holds it. */
const saveLinks = async (companyId, rows, actorId) => {
    let saved = 0;
    for (const row of rows) {
        if (!row.createdTaskId || !Array.isArray(row.links) || !row.links.length) continue;
        const links = row.links.map((link) => ({
            _id: new mongoose.Types.ObjectId(), url: link.url, kind: LINK_KIND, label: link.label, addedBy: actorId, actorType: 'human', agentId: null, addedAt: new Date(),
        }));
        try {
            await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(row.createdTaskId) }, { $set: { links } }] }, 'updateOne');
            saved += links.length;
        } catch (error) {
            failed(`links of task ${row.createdTaskId} not saved`)(error);
        }
    }
    return saved;
};

const threadOf = (project, sprint, row) => ({
    projectId: oid(project._id),
    taskId: oid(row.createdTaskId),
    sprintId: oid(sprint.id),
    project: false,
    ...(sprint.folderId ? { folderId: oid(sprint.folderId) } : {}),
});

/* An author who is a member keeps the comment; anyone else's is stored as the importing person's, led by their name. */
const commentOf = (comment, { memberIdByEmail, actorId }) => {
    const authorId = memberIdByEmail.get(comment.email);
    const text = authorId || !comment.author ? comment.text : `${comment.author}: ${comment.text}`;
    return {
        message: escapeCommentText(text.slice(0, MAX_COMMENT_LENGTH)),
        userId: authorId || actorId,
        type: 'text',
        ...(comment.at ? { createdAt: new Date(comment.at) } : {}),
    };
};

/* The task panel shows a link that a comment carries; the links stored on the task are not drawn there. */
const linksComment = (links, actorId) => ({
    message: escapeCommentText([LINKS_HEADING, ...links.map((link) => (link.label === link.url ? link.url : `${link.label}: ${link.url}`))].join('\n').slice(0, MAX_COMMENT_LENGTH)),
    userId: actorId,
    type: 'link',
});

/* Imported comments are history, not news: saved without the socket emit, the unread counts, the mention notices and
 * the agent starts a comment written in the app sets off. A comment carries text alone, never a file. */
const saveComments = async (companyId, { project, sprint, rows, people, actorId }) => {
    let saved = 0;
    for (const row of rows) {
        if (!row.createdTaskId) continue;
        const thread = threadOf(project, sprint, row);
        const save = (comment) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: { ...comment, ...thread } }, 'save');
        for (const comment of row.comments || []) {
            try {
                await save(commentOf(comment, { memberIdByEmail: people.memberIdByEmail, actorId }));
                saved += 1;
            } catch (error) {
                failed(`comment on task ${row.createdTaskId} not saved`)(error);
            }
        }
        if (Array.isArray(row.links) && row.links.length) await save(linksComment(row.links, actorId)).catch(failed(`links comment on task ${row.createdTaskId} not saved`));
    }
    return saved;
};

/* Plans the import of one list against the project as it is, saves the field definitions, and puts the field values
 * and assignees on the tasks. `afterCreate` writes what needs the created task ids and answers the final summary. */
const prepareClickUpDetails = async (companyId, { actor, project, sprint, tasks, columns, unnamedAssignees, addsTags }) => {
    const projectId = String(project._id);
    const actorId = String(actor.id);
    const allowed = { ...(await detailsAccess(companyId, actorId, projectId)), tags: addsTags };
    const people = await peopleDirectory(companyId, projectId, emailsNamedIn(columns, tasks));
    const state = { projectId, definitions: await projectFieldDefinitions(companyId, projectId), tags: tagNamesOf(project) };
    const plan = planClickUpList({ tasks, columns, unnamedAssignees, state, people, allowed });

    await saveFieldPlan(companyId, { fieldPlan: plan.fieldPlan, projectId, actorId });
    tasks.forEach((task) => {
        task.AssigneeUserId = plan.assignees.get(task) || [];
        delete task.memberEmails;
    });

    const afterCreate = async ({ createdRows, droppedFieldValues = 0 }) => {
        const links = await saveLinks(companyId, createdRows, actorId);
        const comments = allowed.comments ? await saveComments(companyId, { project, sprint, rows: createdRows, people, actorId }) : 0;
        const fields = fieldsSummary(plan.fieldPlan);
        const planned = plan.summary.comments;
        return {
            ...plan.summary,
            links,
            fields: { ...fields, valuesDropped: fields.valuesDropped + droppedFieldValues },
            comments: { ...planned, imported: comments, skipped: planned.skipped + (planned.imported - comments), reason: planned.reason || (comments < planned.imported ? 'failed' : '') },
        };
    };
    return { unmatchedPeople: plan.summary.people.unmatched, afterCreate };
};

/* What importing the whole file would do, list by list as the import runs, with nothing written. Into an existing
 * project each list finds the fields and tags the one before it added; as new projects each list starts empty. */
const previewClickUpPlan = async (companyId, uid, { rows, lists, project, addsTags }) => {
    const projectId = project ? String(project._id) : '';
    const allowed = project ? { ...(await detailsAccess(companyId, uid, projectId)), tags: addsTags } : { ...EVERYTHING, tags: true };
    const read = (listRows) => transformClickUpRows({ rows: listRows, statusFor: (name) => name, leaderId: String(uid) });
    const whole = read(rows);
    const people = await peopleDirectory(companyId, projectId, emailsNamedIn(whole.fields, whole.tasks));
    const empty = { projectId, definitions: project ? await projectFieldDefinitions(companyId, projectId) : [], tags: tagNamesOf(project) };

    let state = empty;
    const summaries = lists.map((list) => {
        const { tasks, fields, unnamedAssignees } = read(list.rowIndexes.map((index) => rows[index]));
        const plan = planClickUpList({ tasks, columns: fields, unnamedAssignees, state, people, allowed });
        if (project) state = stateAfter(state, plan);
        return plan.summary;
    });
    return mergeSummaries(summaries);
};

module.exports = { prepareClickUpDetails, previewClickUpPlan };
