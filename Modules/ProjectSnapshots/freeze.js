const { canManageRules } = require('../Automations/helpers/ruleAccess');
const { customFieldDefinitionsOf } = require('../CustomField/helpers/customFieldText');
const copy = require('../ProjectDuplicate/rules');
const { chunks, sourceRows } = require('../ProjectDuplicate/tasks');
const rules = require('./rules');
const store = require('./store');

const instantOf = (value) => {
    const at = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(at) ? at : null;
};

/* Stores `bundle` and the planned tasks as a template. The task rows go in first, in batches, and the template row last: a save
   that breaks leaves nothing a reader can reach, and takes back the task rows it wrote. */
const freeze = async ({ companyId, caller, source, bundle, plan, request }) => {
    const { name, include } = request;
    const anchor = instantOf(source.StartDate) ?? instantOf(source.createdAt) ?? Date.now();
    const fields = { definitions: new Map(), linked: new Set(bundle.fieldIds) };
    await customFieldDefinitionsOf(companyId, rules.fieldIdsIn([source]), fields.definitions);

    const keepsRules = include.automations && bundle.rules.length > 0 && await canManageRules(companyId, caller);
    const frozen = rules.frozenStructure({ ...bundle, rules: keepsRules ? bundle.rules : [] }, { name, caller, companyId, include, anchor, fields });
    const notes = [...bundle.notes, ...frozen.notes];
    if (include.automations && bundle.rules.length && !keepsRules) notes.push({ code: 'automations_skipped', count: bundle.rules.length });
    if (plan.left) notes.push({ code: 'tasks_left_out', count: plan.left });

    const templateId = copy.newId();
    const readRows = sourceRows(companyId, String(source._id));
    const people = new Set(frozen.snapshot.people);
    plan.levels.flat().forEach((row) => frozen.ids.set(String(row._id), String(copy.newId())));
    let part = 0;
    let kept = 0;
    try {
        for (const level of plan.levels) {
            for (const batch of chunks(level, rules.TASKS_PER_ROW)) {
                const rows = await readRows(batch);
                await customFieldDefinitionsOf(companyId, rules.fieldIdsIn(rows), fields.definitions);
                const tasks = rows.map((row) => rules.frozenTask(row, { ids: frozen.ids, include, anchor, fields }));
                rules.peopleIn(tasks).forEach((id) => people.add(id));
                await store.saveTaskRows(companyId, templateId, part, tasks);
                part += 1;
                kept += tasks.length;
            }
        }
        const template = await store.saveTemplate(companyId, {
            _id: templateId,
            name,
            description: request.description || '',
            everyone: typeof request.everyone === 'boolean' ? request.everyone : !frozen.holdsPrivate,
            sourcePrivate: frozen.holdsPrivate,
            include: { ...include, automations: include.automations && (keepsRules || !bundle.rules.length) },
            counts: { folders: frozen.snapshot.folders.length, lists: frozen.snapshot.lists.length, tasks: kept, automations: frozen.snapshot.rules.length },
            statuses: (Array.isArray(source.taskStatusData) ? source.taskStatusData : []).map((status) => copy.pick(status || {}, ['key', 'name', 'type'])),
            snapshot: { ...frozen.snapshot, people: [...people] },
            createdBy: caller,
            updatedBy: caller,
        });
        return { template, notes };
    } catch (error) {
        await store.dropTaskRows(companyId, templateId).catch(() => {});
        throw error;
    }
};

module.exports = { freeze };
