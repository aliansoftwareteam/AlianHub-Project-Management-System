const lower = (value) => String(value ?? "").trim().toLowerCase();
const unique = (values) => values.filter((value, index) => values.findIndex((other) => lower(other) === lower(value)) === index);

const emptySummary = () => ({
    tasks: 0,
    subtasks: { level2: 0, level3: 0 },
    comments: { imported: 0, skipped: 0, reason: "", unmatchedAuthors: [] },
    fields: { created: [], reused: [], asText: [], skipped: [], reason: "", valuesSet: 0, valuesDropped: 0 },
    checklistItems: 0,
    tags: { added: [], skipped: [] },
    links: 0,
    people: { unmatched: [], cannotOpen: [] }
});

/* An import runs as one request per ClickUp list, each answering its own summary. Mirrors mergeSummaries in
   Modules/Importers/helpers/clickupPlan.js, which merges the preview's plan the same way. */
export function mergeSummaries(summaries) {
    const merged = (summaries || []).filter(Boolean).reduce((sum, one) => ({
        tasks: sum.tasks + one.tasks,
        subtasks: { level2: sum.subtasks.level2 + one.subtasks.level2, level3: sum.subtasks.level3 + one.subtasks.level3 },
        comments: {
            imported: sum.comments.imported + one.comments.imported,
            skipped: sum.comments.skipped + one.comments.skipped,
            reason: sum.comments.reason || one.comments.reason,
            unmatchedAuthors: unique([...sum.comments.unmatchedAuthors, ...one.comments.unmatchedAuthors])
        },
        fields: {
            created: unique([...sum.fields.created, ...one.fields.created]),
            reused: unique([...sum.fields.reused, ...one.fields.reused]),
            asText: unique([...sum.fields.asText, ...one.fields.asText]),
            skipped: unique([...sum.fields.skipped, ...one.fields.skipped]),
            reason: sum.fields.reason || one.fields.reason,
            valuesSet: sum.fields.valuesSet + one.fields.valuesSet,
            valuesDropped: sum.fields.valuesDropped + one.fields.valuesDropped
        },
        checklistItems: sum.checklistItems + one.checklistItems,
        tags: { added: unique([...sum.tags.added, ...one.tags.added]), skipped: unique([...sum.tags.skipped, ...one.tags.skipped]) },
        links: sum.links + one.links,
        people: { unmatched: unique([...sum.people.unmatched, ...one.people.unmatched]), cannotOpen: unique([...sum.people.cannotOpen, ...one.people.cannotOpen]) }
    }), emptySummary());
    const created = new Set(merged.fields.created.map(lower));
    merged.fields.reused = merged.fields.reused.filter((name) => !created.has(lower(name)));
    return merged;
}

const REASONS = ["no_permission", "failed"];
const reasonKey = (prefix, reason) => `${prefix}_${REASONS.includes(reason) ? reason : "failed"}`;

/* One row per kind the file holds: what comes in and what is left out, with the reason. A kind the file does not hold has no row. */
export function countRows(summary, t, prefix) {
    const { comments, fields, tags, people } = summary;
    const fieldCount = fields.created.length + fields.reused.length;
    const peopleOut = [
        people.unmatched.length ? t(`${prefix}.out_people_unmatched`, { count: people.unmatched.length }) : "",
        people.cannotOpen.length ? t(`${prefix}.out_people_cannot_open`, { count: people.cannotOpen.length }) : ""
    ].filter(Boolean).join("; ");
    return [
        { key: "tasks", show: true, into: summary.tasks, out: "" },
        { key: "subtasks_2", show: summary.subtasks.level2 > 0, into: summary.subtasks.level2, out: "" },
        { key: "subtasks_3", show: summary.subtasks.level3 > 0, into: summary.subtasks.level3, out: "" },
        { key: "comments", show: comments.imported + comments.skipped > 0, into: comments.imported, out: comments.skipped ? t(reasonKey(`${prefix}.out_comments`, comments.reason), { count: comments.skipped }) : "" },
        { key: "fields", show: fieldCount + fields.skipped.length > 0, into: t(`${prefix}.counts_fields_in`, { created: fields.created.length, reused: fields.reused.length }), out: fields.skipped.length ? t(reasonKey(`${prefix}.out_fields`, fields.reason), { count: fields.skipped.length }) : "" },
        { key: "values", show: fields.valuesSet + fields.valuesDropped > 0, into: fields.valuesSet, out: fields.valuesDropped ? t(`${prefix}.out_values`, { count: fields.valuesDropped }) : "" },
        { key: "checklist", show: summary.checklistItems > 0, into: summary.checklistItems, out: "" },
        { key: "tags", show: tags.added.length + tags.skipped.length > 0, into: tags.added.length, out: tags.skipped.length ? t(`${prefix}.out_tags`, { count: tags.skipped.length }) : "" },
        { key: "links", show: summary.links > 0, into: summary.links, out: "" },
        { key: "people", show: Boolean(peopleOut), into: "", out: peopleOut }
    ].filter((row) => row.show).map(({ key, into, out }) => ({ key, label: t(`${prefix}.counts_${key}`), into, out }));
}

export function countNotes(summary, t, prefix, planned) {
    const named = (key, names) => (names.length ? { key, text: t(`${prefix}.${key}`, { names: names.join(", ") }) } : null);
    return [
        summary.links > 0 ? { key: "note_links", text: t(`${prefix}.note_links_${planned ? "plan" : "done"}`, { count: summary.links }) } : null,
        named("note_as_text", summary.fields.asText),
        named("note_fields_skipped", summary.fields.skipped),
        named("note_tags_skipped", summary.tags.skipped),
        named("note_authors", summary.comments.unmatchedAuthors),
        named("note_people_cannot_open", summary.people.cannotOpen)
    ].filter(Boolean);
}
