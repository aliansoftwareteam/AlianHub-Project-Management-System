/* What importing one ClickUp list brings in and what it leaves out, with nothing written. The preview answers this plan
 * and the import carries it out, so both count the same way. Pure, no I/O. */
const { levelRows } = require('../../Tasks/helpers/taskTreeRules');
const { planFields, NO_PERMISSION } = require('./clickupFields');
const { newComments } = require('./importComments');

const SKIP = 'skip';
const UPDATE = 'update';
const NOTHING_HERE = Object.freeze({ mode: SKIP, stored: new Map(), commentKeys: new Map() });

const lower = (value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase();
const unique = (values) => values.filter((value, index) => values.findIndex((other) => lower(other) === lower(value)) === index);
const total = (tasks, count) => tasks.reduce((sum, task) => sum + count(task), 0);

const emptySummary = () => ({
    tasks: 0,
    subtasks: { level2: 0, level3: 0 },
    comments: { imported: 0, skipped: 0, reason: '', unmatchedAuthors: [] },
    fields: { created: [], reused: [], asText: [], skipped: [], reason: '', valuesSet: 0, valuesDropped: 0 },
    checklistItems: 0,
    tags: { added: [], skipped: [] },
    links: 0,
    people: { unmatched: [], cannotOpen: [] },
    existing: { skipped: 0, updated: 0 },
});

const commentsOf = (tasks, { authorIdByEmail }, allowed, commentKeys) => {
    const comments = tasks.flatMap((task) => newComments(task, commentKeys));
    if (!allowed) return { imported: 0, skipped: comments.length, reason: comments.length ? NO_PERMISSION : '', unmatchedAuthors: [] };
    const strangers = comments.filter((comment) => comment.author && !authorIdByEmail.has(comment.email)).map((comment) => comment.author);
    return { imported: comments.length, skipped: 0, reason: '', unmatchedAuthors: unique(strangers) };
};

const fieldsSummary = ({ columns }) => {
    const named = (action) => columns.filter((column) => column.action === action).map((column) => column.name);
    const skipped = columns.filter((column) => column.action === 'skipped');
    return {
        created: named('create'),
        reused: named('reuse'),
        asText: columns.filter((column) => column.asText && ['create', 'reuse'].includes(column.action)).map((column) => column.name),
        skipped: skipped.map((column) => column.name),
        reason: skipped.length ? skipped[0].reason : '',
        valuesSet: columns.reduce((sum, column) => sum + column.set, 0),
        valuesDropped: columns.reduce((sum, column) => sum + column.dropped, 0),
    };
};

const tagsOf = (tasks, known, allowed) => {
    const have = new Set((known || []).map(lower));
    const fresh = unique(tasks.flatMap((task) => task.tagNames || [])).filter((name) => !have.has(lower(name)));
    return allowed ? { added: fresh, skipped: [] } : { added: [], skipped: fresh };
};

/* `state` is the project as the import finds it: its id, the field definitions it may use and its tag names. `people`
 * maps each email the file names to a member, to a member who can open the project, and to a member whose comments
 * this import may keep under their own name. `allowed` says whether the person importing may edit fields, comment,
 * and add tags. `existing` holds the tasks of the project a row's ClickUp id already names (`stored`, as
 * `{ id, ancestors, sprintId, folderId }`), the imported comments those tasks hold, and whether such a row is left
 * alone or updates its task. A row that is left alone takes no part in the plan; a new row whose parent is already here
 * goes under it. */
const planClickUpList = ({ tasks: rows, columns, unnamedAssignees = [], state, people, allowed, existing = NOTHING_HERE }) => {
    const again = rows.filter((task) => existing.stored.has(task.importSourceId));
    const fresh = rows.filter((task) => !existing.stored.has(task.importSourceId));
    const updates = existing.mode === UPDATE ? again : [];
    updates.forEach((task) => { task.storedTask = existing.stored.get(task.importSourceId); });
    const tasks = [...fresh, ...updates];
    const { levels } = levelRows(fresh, existing.stored);
    const fieldPlan = planFields({
        columns,
        tasks,
        definitions: state.definitions,
        projectId: state.projectId,
        idByEmail: people.openIdByEmail,
        allowed: allowed.fields,
    });

    const assignees = new Map(tasks.map((task) => [task, unique((task.memberEmails || []).map((email) => people.openIdByEmail.get(lower(email))).filter(Boolean))]));
    const named = unique([...tasks.flatMap((task) => task.memberEmails || []), ...fieldPlan.unmatchedPeople]);
    const outside = named.filter((entry) => !people.openIdByEmail.has(lower(entry)));

    const summary = {
        tasks: levels[0].length,
        subtasks: { level2: levels[1].length, level3: levels[2].length },
        comments: commentsOf(tasks, people, allowed.comments, existing.commentKeys),
        fields: fieldsSummary(fieldPlan),
        checklistItems: total(fresh, (task) => total(task.checklists || [], (checklist) => checklist.items.length)),
        tags: tagsOf(tasks, state.tags, allowed.tags),
        links: total(fresh, (task) => (task.links || []).length),
        people: {
            unmatched: unique([...outside.filter((entry) => !people.memberIdByEmail.has(lower(entry))), ...unnamedAssignees]),
            cannotOpen: outside.filter((entry) => people.memberIdByEmail.has(lower(entry))),
        },
        existing: { skipped: again.length - updates.length, updated: updates.length },
    };
    return { summary, fieldPlan, assignees, fresh, updates };
};

/* The project as the next list of the same file finds it: the fields and tags this list added are there. */
const stateAfter = (state, { summary, fieldPlan }) => {
    const planned = fieldPlan.columns.filter((column) => column.definition && ['create', 'reuse'].includes(column.action));
    const created = planned.filter((column) => column.action === 'create')
        .map((column, index) => ({ ...column.definition, _id: `planned:${state.definitions.length + index}`, type: 'task', global: false, projectId: [state.projectId], isDelete: true }));
    const updated = new Map(planned.filter((column) => column.action === 'reuse').map((column) => [column.definition._id, column.definition]));
    return {
        ...state,
        definitions: [...state.definitions.map((definition) => updated.get(definition._id) || definition), ...created],
        tags: [...(state.tags || []), ...summary.tags.added],
    };
};

const mergeSummaries = (summaries) => {
    const merged = summaries.reduce((sum, one) => ({
        tasks: sum.tasks + one.tasks,
        subtasks: { level2: sum.subtasks.level2 + one.subtasks.level2, level3: sum.subtasks.level3 + one.subtasks.level3 },
        comments: {
            imported: sum.comments.imported + one.comments.imported,
            skipped: sum.comments.skipped + one.comments.skipped,
            reason: sum.comments.reason || one.comments.reason,
            unmatchedAuthors: unique([...sum.comments.unmatchedAuthors, ...one.comments.unmatchedAuthors]),
        },
        fields: {
            created: unique([...sum.fields.created, ...one.fields.created]),
            reused: unique([...sum.fields.reused, ...one.fields.reused]),
            asText: unique([...sum.fields.asText, ...one.fields.asText]),
            skipped: unique([...sum.fields.skipped, ...one.fields.skipped]),
            reason: sum.fields.reason || one.fields.reason,
            valuesSet: sum.fields.valuesSet + one.fields.valuesSet,
            valuesDropped: sum.fields.valuesDropped + one.fields.valuesDropped,
        },
        checklistItems: sum.checklistItems + one.checklistItems,
        tags: { added: unique([...sum.tags.added, ...one.tags.added]), skipped: unique([...sum.tags.skipped, ...one.tags.skipped]) },
        links: sum.links + one.links,
        people: { unmatched: unique([...sum.people.unmatched, ...one.people.unmatched]), cannotOpen: unique([...sum.people.cannotOpen, ...one.people.cannotOpen]) },
        existing: { skipped: sum.existing.skipped + ((one.existing || {}).skipped || 0), updated: sum.existing.updated + ((one.existing || {}).updated || 0) },
    }), emptySummary());
    const created = new Set(merged.fields.created.map(lower));
    merged.fields.reused = merged.fields.reused.filter((name) => !created.has(lower(name)));
    return merged;
};

module.exports = { SKIP, UPDATE, emptySummary, planClickUpList, stateAfter, mergeSummaries, fieldsSummary };
