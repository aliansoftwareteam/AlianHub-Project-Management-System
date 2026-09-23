const logger = require('../../../Config/loggerConfig');
const { HandleHistory } = require('../../Tasks/helpers/helper');
const { employeeNameOf, escapeText } = require('../../Tasks/helpers/taskWriteFields');

const HISTORY = Object.freeze({
    CHECKLIST: 'Task_Checklist',
    CHECKLIST_ASSIGN: 'Task_Checklist_Assign',
    CHECKLIST_UNASSIGN: 'Task_Checklist_Remove',
    CHECKLIST_CHECKED: 'CheckList_Checked',
    CHECKLIST_FROM_COMMENT: 'Project_Comment',
    TAG: 'Project_Name',
});

/* Project_Comment was the comment box's key for the checklist it creates; the checklist route now records those items itself. */
const SERVER_BUILT_HISTORY = [
    HISTORY.CHECKLIST, HISTORY.CHECKLIST_ASSIGN, HISTORY.CHECKLIST_UNASSIGN, HISTORY.CHECKLIST_CHECKED, HISTORY.CHECKLIST_FROM_COMMENT,
].map((key) => ({ type: 'project', key }));

const itemName = (name) => `<b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${name}">${name}</b>`;
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);

const pushed = ({ A, body }) => {
    const item = body.checklistItem;
    if (!isPlainObject(item)) return [];
    if (!item.parentId) return [{ key: HISTORY.CHECKLIST, message: `<b>${A}</b> has created new checklist` }];
    return [{ key: HISTORY.CHECKLIST, message: `<b>${A}</b> has created new checklist item ${itemName(escapeText(item.name))}` }];
};

const childrenOf = (items, id) => items.filter((item) => sameId(item.parentId, id));
const descendantNames = (items, id) => childrenOf(items, id).flatMap((child) => [escapeText(child.name), ...descendantNames(items, child.id)]);

const removed = ({ A, body, previous }) => {
    const ids = Array.isArray(body.checklistItem) ? body.checklistItem.map(String) : [];
    const gone = previous.filter((item) => ids.includes(String(item.id)));
    const tops = gone.filter((item) => !ids.includes(String(item.parentId)));
    return tops.map((top) => {
        const subItems = descendantNames(previous, top.id).join('\n');
        return { key: HISTORY.CHECKLIST, message: `<b>${A}</b> has removed checklist item ${itemName(escapeText(top.name))} and its subitems ${itemName(subItems)}` };
    });
};

/* Checking an item checks its children too; only the item whose parent kept its state is the one the person clicked. */
const checked = ({ A, body, previous }) => {
    if (!Array.isArray(body.checklistItem)) return [];
    const before = new Map(previous.map((item) => [String(item.id), Boolean(item.isChecked)]));
    const flipped = body.checklistItem.filter((item) => isPlainObject(item) && before.has(String(item.id)) && before.get(String(item.id)) !== Boolean(item.isChecked));
    const flippedIds = flipped.map((item) => String(item.id));
    return flipped
        .filter((item) => !flippedIds.includes(String(item.parentId)))
        .map((item) => ({ key: HISTORY.CHECKLIST_CHECKED, message: `<b>${A}</b> has <b>${item.isChecked ? 'checked' : 'unchecked'}</b> <b>${escapeText(item.name)}</b> checklist.` }));
};

const renamed = ({ A, body, previous }) => {
    const item = body.checklistItem;
    const stored = isPlainObject(item) && previous.find((candidate) => sameId(candidate.id, item.id));
    if (!stored || String(stored.name) === String(item.name)) return [];
    return [{ key: HISTORY.CHECKLIST, message: `<b>${A}</b> has changed checklist item name from <b>${escapeText(stored.name)}</b> to <b>${escapeText(item.name)}</b>` }];
};

const assigneeChanged = async ({ A, body, previous, nameOf }) => {
    const item = body.checklistItem;
    const stored = isPlainObject(item) && previous.find((candidate) => sameId(candidate.id, item.id));
    if (!stored) return [];
    const adding = body.key === 'assigneeAdd';
    const assigned = (stored.AssigneeUserId || []).map(String).includes(String(item.uid));
    if (adding === assigned) return [];
    const U = escapeText(await nameOf(String(item.uid)));
    const N = escapeText(stored.name);
    return [adding
        ? { key: HISTORY.CHECKLIST_ASSIGN, message: `<b>${A}</b> has added <b>${U}</b> into checklist item <b>${N}</b>` }
        : { key: HISTORY.CHECKLIST_UNASSIGN, message: `<b>${A}</b> has removed <b>${U}</b> from checklist item <b>${N}</b>` }];
};

const CHECKLIST_UPDATES = { name: renamed, isChecked: checked, assigneeAdd: assigneeChanged, assigneeRemove: assigneeChanged };

const describeChecklistChange = async ({ actor, previous, body, nameOf = employeeNameOf }) => {
    const ctx = { A: actor.Employee_Name, body: body || {}, previous: (previous || []).filter(isPlainObject), nameOf };
    if (ctx.body.operation === 'push') return pushed(ctx);
    if (ctx.body.operation === 'delete') return removed(ctx);
    if (ctx.body.operation === 'update' && Object.hasOwn(CHECKLIST_UPDATES, ctx.body.key)) return CHECKLIST_UPDATES[ctx.body.key](ctx);
    return [];
};

const describeTagDefinitionChange = ({ actor, previous, body }) => {
    const { operation, key, items } = body || {};
    if (!isPlainObject(items) || !['update', 'delete'].includes(operation)) return [];
    const stored = (previous || []).find((tag) => isPlainObject(tag) && sameId(tag.uid, items.id));
    if (!stored) return [];
    const A = actor.Employee_Name;
    const N = escapeText(stored.tagName);
    if (operation === 'delete') return [{ key: HISTORY.TAG, message: `<b>${A}</b> has deleted the <b> ${N} Tag </b>` }];
    if (key === 'tagName' && String(items.tagName) !== String(stored.tagName)) {
        return [{ key: HISTORY.TAG, message: `<b>${A}</b> has renamed the Tag from <b>  ${N}  </b> to <b>${escapeText(items.tagName)} </b>` }];
    }
    if (key === 'tagColor' && String(items.tagColor) !== String(stored.tagColor)) {
        return [{ key: HISTORY.TAG, message: `<b>${A}</b> has changed the Tag color of ${N}` }];
    }
    return [];
};

const sessionActorOf = async (uid) => ({ id: String(uid), Employee_Name: escapeText(await employeeNameOf(String(uid))) });

const write = (companyId, projectId, actor, entries) => Promise.all(entries.map((entry) => HandleHistory('project', companyId, String(projectId), null, entry, actor)
    .catch((error) => logger.error(`project item history: ${(error && error.message) || JSON.stringify(error)}`))));

const recordChecklistChange = async ({ companyId, projectId, actorId, previous, body }) => {
    if (!previous) return;
    const actor = await sessionActorOf(actorId);
    const entries = await describeChecklistChange({ actor, previous: plain(previous).checklistArray, body });
    if (entries.length) await write(companyId, projectId, actor, entries);
};

const recordTagDefinitionChange = async ({ companyId, projectId, actorId, previous, body }) => {
    if (!previous) return;
    const actor = await sessionActorOf(actorId);
    const entries = describeTagDefinitionChange({ actor, previous: plain(previous).tagsArray, body });
    if (entries.length) await write(companyId, projectId, actor, entries);
};

module.exports = {
    HISTORY,
    SERVER_BUILT_HISTORY,
    describeChecklistChange,
    describeTagDefinitionChange,
    recordChecklistChange,
    recordTagDefinitionChange,
};
