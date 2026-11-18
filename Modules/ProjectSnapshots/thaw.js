const { customFieldDefinitionsOf } = require('../CustomField/helpers/customFieldText');
const { planOf } = require('../ProjectDuplicate/tasks');
const rules = require('./rules');
const store = require('./store');

/* What the project copy needs to make a project out of `template`: the stored rows as a source to copy, a plan of its tasks and a
   reader of them. A person, a status or a field the template names that is gone by now is left out and noted, never an error. */
const thaw = async ({ companyId, caller, template, request }) => {
    const { snapshot } = template;
    const templateId = String(template._id);
    const kept = template.include || {};
    const include = Object.fromEntries(rules.INCLUDE_KEYS.map((key) => [key, request.include[key] === true && kept[key] === true]));
    const start = include.dates ? (request.start ?? rules.startOfDay(Date.now())) : null;

    const gone = new Set(include.assignees ? await store.absentPeople(companyId, snapshot.people) : []);
    const fieldIds = snapshot.fieldIds || [];
    const definitions = await customFieldDefinitionsOf(companyId, [...fieldIds, ...rules.fieldIdsIn([snapshot.project])]);
    const fields = { definitions, linked: new Set(fieldIds.filter((id) => definitions.get(id) && definitions.get(id).global !== true)) };
    const missingFields = fieldIds.filter((id) => !definitions.get(id)).length;
    const { statuses, skipped: missingStatuses } = rules.usableStatuses(snapshot.project.taskStatusData, await store.companyStatusKeys(companyId));

    const bundle = rules.thawedBundle(snapshot, { caller, include, start, isPrivate: request.isPrivate, gone, statuses, fields });
    if (gone.size) bundle.notes.push({ code: 'people_skipped', count: gone.size });
    if (missingStatuses) bundle.notes.push({ code: 'statuses_skipped', count: missingStatuses });
    if (missingFields) bundle.notes.push({ code: 'fields_skipped', count: missingFields });

    const first = rules.firstStatusOf(statuses);
    return {
        bundle,
        include,
        planFor: async () => planOf(await store.taskIndex(companyId, templateId)),
        readRows: async (batch) => {
            const rows = await store.tasksOf(companyId, templateId, batch);
            await customFieldDefinitionsOf(companyId, rules.fieldIdsIn(rows), definitions);
            return rows.map((row) => rules.thawedTask(row, { include, start, gone, first, fields }));
        },
    };
};

module.exports = { thaw };
