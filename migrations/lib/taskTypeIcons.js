/* Library icon/colour for every task type, and a repair for the NaN/duplicate
 * keys older projects carry. Matching is always by value, never by key. */
const DEFAULT_COLOR = '#2F3990';
const DEFAULT_ICON = 'mdi:checkbox-marked-circle';
const VALUE_MAP = {
    task: ['checkbox-marked-circle', '#2F3990'],
    sub_task: ['subdirectory-arrow-right', '#9CA3AF'],
    bug: ['bug', '#DC2626'],
    design: ['palette', '#F76808'],
    bid: ['gavel', '#0EA5E9'],
    invitation: ['email', '#8B5CF6'],
    existing_client: ['account-check', '#059669'],
    client_meeting: ['calendar-account', '#0D9488'],
    discussion: ['forum', '#6366F1'],
    leads: ['bullseye-arrow', '#F59E0B'],
    to_do: ['format-list-checks', '#64748B'],
    training_task: ['school', '#7C3AED'],
    admin: ['shield-account', '#475569'],
    'user_interface_(ui)': ['monitor-dashboard', '#2563EB'],
    'user_experience_(ux)': ['gesture-tap', '#DB2777'],
    graphic_design: ['vector-square', '#F97316'],
    branding: ['fingerprint', '#E11D48'],
    web_design: ['web', '#0891B2'],
    print_design: ['printer', '#7C3AED'],
    motion_graphics: ['movie-open', '#C026D3'],
    'photography/videography': ['camera', '#0284C7'],
    content_creation: ['pencil', '#16A34A'],
    storyboarding: ['filmstrip', '#9333EA'],
    'feedback_&_revision': ['comment-edit', '#EA580C'],
    financial_analysis: ['chart-line', '#059669'],
    bookkeeping: ['notebook', '#0D9488'],
    auditing: ['clipboard-check', '#CA8A04'],
    taxation: ['calculator-variant', '#B45309'],
    financial_reporting: ['file-chart', '#2563EB'],
    cost_management: ['cash-minus', '#DC2626'],
    cash_management: ['cash-multiple', '#16A34A'],
    engagement_tasks: ['handshake', '#DB2777'],
    collaboration_tasks: ['account-multiple', '#0EA5E9'],
    support_tasks: ['lifebuoy', '#0891B2'],
    content_creation_tasks: ['pencil-box', '#16A34A'],
    in_progress: ['progress-clock', '#F59E0B'],
    in_review: ['eye-check', '#6366F1'],
    backlog: ['format-list-bulleted', '#64748B'],
    approved: ['check-decagram', '#16A34A'],
    done: ['check-circle', '#16A34A'],
    complete: ['check-all', '#059669'],
    backlog_refinement: ['playlist-edit', '#7C3AED'],
    development: ['code-tags', '#2563EB'],
    sprint_planning: ['calendar-check', '#0D9488'],
    optimization: ['speedometer', '#EA580C'],
    image: ['image', '#0EA5E9'],
    test: ['test-tube', '#7C3AED'],
    testing: ['test-tube', '#0D9488'],
    qa: ['clipboard-check', '#CA8A04'],
    backlog_grooming: ['playlist-check', '#8B5CF6'],
    feature_development: ['source-branch', '#2563EB'],
    code_review: ['eye-check', '#6366F1'],
    bug_fixing: ['bug-check', '#DC2626'],
    integration: ['merge', '#0891B2'],
    feedback_collection: ['comment-quote', '#EA580C'],
    story: ['bookmark', '#16A34A'],
    epic: ['flag', '#9333EA'],
    subtask: ['subdirectory-arrow-right', '#9CA3AF'],
    feature: ['star', '#F59E0B'],
    content: ['text-box', '#16A34A'],
    'ui/ux': ['palette-swatch', '#DB2777'],
    frontend: ['language-html5', '#2563EB'],
    backend: ['server', '#7C3AED'],
    admin_panel: ['view-dashboard', '#475569'],
    database: ['database', '#0D9488'],
    devops: ['infinity', '#EA580C'],
    shopify_task: ['storefront', '#16A34A'],
    mobile: ['cellphone', '#0EA5E9'],
    litigation_support: ['scale-balance', '#B45309'],
    contract_review: ['file-sign', '#CA8A04'],
    document_drafting: ['file-document-edit', '#0D9488'],
    legal_research: ['book-search', '#7C3AED'],
    ddddsee334434: ['help-circle', '#9CA3AF'],
    demo_25: ['help-circle', '#9CA3AF'],
};
const KEYWORD = [
    ['bug', 'bug', '#DC2626'], ['sub task', 'subdirectory-arrow-right', '#9CA3AF'],
    ['subtask', 'subdirectory-arrow-right', '#9CA3AF'], ['design', 'palette', '#F76808'],
    ['story', 'bookmark', DEFAULT_COLOR], ['epic', 'flag', DEFAULT_COLOR],
    ['feature', 'star', DEFAULT_COLOR], ['research', 'magnify', DEFAULT_COLOR],
    ['test', 'test-tube', DEFAULT_COLOR], ['review', 'eye-check', '#6366F1'],
    ['doc', 'file-document', DEFAULT_COLOR], ['meeting', 'account-group', '#0D9488'],
    ['task', 'checkbox-marked-circle', DEFAULT_COLOR],
];
const STATUS_LIKE = new Set(['in_progress', 'in_review', 'backlog', 'approved', 'done', 'complete']);

function mapFor(entry) {
    const value = String(entry.value || '').toLowerCase();
    const name = String(entry.name || '').toLowerCase();
    if (VALUE_MAP[value]) return { icon: `mdi:${VALUE_MAP[value][0]}`, color: VALUE_MAP[value][1] };
    for (const [kw, icon, color] of KEYWORD) {
        if (value.includes(kw) || name.includes(kw)) return { icon: `mdi:${icon}`, color };
    }
    return { icon: DEFAULT_ICON, color: DEFAULT_COLOR };
}

const hasIcon = (e) => Boolean(e && e.iconType === 'library' && e.iconValue && e.iconColor);

/* Entries that already carry an icon keep it: a type an admin recoloured must survive a rerun. */
function withIcon(entry) {
    if (hasIcon(entry)) return entry;
    const { icon, color } = mapFor(entry);
    return { ...entry, iconType: 'library', iconValue: icon, iconColor: color };
}

const isBadKey = (k) => !Number.isInteger(k);

/* Merges same-value duplicates onto one keeper, then gives every keeper with a
 * NaN or duplicate key a fresh unique integer. Valid, unclaimed keys survive so
 * their tasks need no rewrite. */
function rekey(entries) {
    const groups = new Map();
    for (const e of entries) {
        const v = String(e.value || '').toLowerCase();
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(e);
    }
    const merges = [];
    const keepers = [];
    for (const group of groups.values()) {
        if (group.length === 1) { keepers.push(group[0]); continue; }
        const keeper = group.find((g) => g.iconValue)
            || group.filter((g) => Number.isInteger(g.key)).sort((a, b) => a.key - b.key)[0]
            || group[0];
        keepers.push(keeper);
        merges.push({ value: group[0].value, kept: keeper.key, droppedCount: group.length - 1 });
    }
    const claimed = new Set();
    let next = keepers.reduce((m, e) => (Number.isInteger(e.key) && e.key > m ? e.key : m), 0);
    const changes = [];
    const valueToKey = {};
    const out = keepers.map((e) => {
        const value = String(e.value || '');
        let key = e.key;
        if (isBadKey(key) || claimed.has(key)) {
            key = ++next;
            changes.push({ value, old: e.key, new: key });
        }
        claimed.add(key);
        valueToKey[value.toLowerCase()] = key;
        return { ...e, key };
    });
    return { entries: out, changes, merges, valueToKey };
}

/* One company: repairs project keys, rewrites the tasks that pointed at a
 * dropped or re-keyed entry, and stamps icons on projects, the catalogue and
 * the templates. Idempotent: a second run finds nothing to change. */
async function applyTaskTypeIcons(ctx, companyId) {
    const { SCHEMA_TYPE, settingsCollectionDocs } = ctx;
    const crud = (type, data, method) => ctx.company(companyId, { type, data }, method);
    const summary = { projects: 0, keyFixes: 0, merged: 0, tasksRewritten: 0, iconsSet: 0 };

    const projects = await crud(SCHEMA_TYPE.PROJECTS, [{ 'taskTypeCounts.0': { $exists: true } }, { ProjectName: 1, taskTypeCounts: 1 }], 'find');
    for (const p of projects || []) {
        const pid = String(p._id);
        const original = Array.isArray(p.taskTypeCounts) ? p.taskTypeCounts.map((e) => (e && e.toObject ? e.toObject() : e)) : [];
        const { entries, changes, merges } = rekey(original);
        const finalEntries = entries.map(withIcon);
        const changed = changes.length || merges.length || finalEntries.some((e, i) => e !== original[i]);
        summary.projects += 1;
        summary.keyFixes += changes.length;
        summary.merged += merges.reduce((s, m) => s + m.droppedCount, 0);
        if (changed) {
            await crud(SCHEMA_TYPE.PROJECTS, [{ _id: p._id }, { $set: { taskTypeCounts: finalEntries } }], 'updateOne');
            summary.iconsSet += finalEntries.length;
        }
        for (const e of finalEntries) {
            if (!e.value) continue;
            const result = await crud(SCHEMA_TYPE.TASKS,
                [{ ProjectID: pid, TaskType: e.value, TaskTypeKey: { $ne: e.key } }, { $set: { TaskTypeKey: e.key } }], 'updateMany');
            summary.tasksRewritten += (result && result.modifiedCount) || 0;
        }
    }

    const settingsDoc = await crud(SCHEMA_TYPE.SETTINGS, [{ name: settingsCollectionDocs.TASK_TYPE }], 'findOne');
    if (settingsDoc && Array.isArray(settingsDoc.settings) && !settingsDoc.settings.every(hasIcon)) {
        const settings = settingsDoc.settings.map((e) => (e && e.toObject ? e.toObject() : e)).map(withIcon);
        await crud(SCHEMA_TYPE.SETTINGS, [{ name: settingsCollectionDocs.TASK_TYPE }, { $set: { settings } }], 'updateOne');
        summary.iconsSet += settings.length;
    }
    const templates = await crud(SCHEMA_TYPE.TASK_TYPE_TEMPLATES, [{}], 'find');
    for (const t of templates || []) {
        if (!Array.isArray(t.taskTypes) || t.taskTypes.every(hasIcon)) continue;
        const taskTypes = t.taskTypes.map((e) => (e && e.toObject ? e.toObject() : e)).map(withIcon);
        await crud(SCHEMA_TYPE.TASK_TYPE_TEMPLATES, [{ _id: t._id }, { $set: { taskTypes } }], 'updateOne');
        summary.iconsSet += taskTypes.length;
    }
    return summary;
}

module.exports = { rekey, mapFor, withIcon, hasIcon, isBadKey, VALUE_MAP, STATUS_LIKE, applyTaskTypeIcons };
