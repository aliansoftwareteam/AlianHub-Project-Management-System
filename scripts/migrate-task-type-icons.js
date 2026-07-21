/**
 * Task-type migration — backfill library icons/colors + repair malformed keys.
 *
 * Implements .claude/MIGRATION-task-type-icons-and-keys.md. Two workstreams:
 *   A) Icons/colors: set iconType='library', iconValue, iconColor on every task
 *      type across settings(TASK_TYPE), task_type_templates, and every project's
 *      taskTypeCounts — matched by `value` (keyword fallback), never by key.
 *   B) Key repair: per project, give NaN/duplicate keys fresh unique keys and
 *      rewrite each task's TaskTypeKey by resolving its TaskType *value* string.
 *
 * DRY-RUN BY DEFAULT — prints a report and writes nothing. Pass --apply to mutate.
 * Scope is a single company (--company <id>). BACK UP THE DB before --apply.
 *
 *   node scripts/migrate-task-type-icons.js --company <companyId>            # dry-run
 *   node scripts/migrate-task-type-icons.js --company <companyId> --apply    # execute
 *
 * Ordering: B (keys) then A (icons) so icon fields land on the final entries.
 * Decisions baked in (see spec): orphans left untouched + reported; status-like
 * rows left in place, usage reported; single company; no same-value merges expected.
 */
require('dotenv').config();
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');

// Set from CLI args in the main guard at the bottom (kept out of module scope so
// the pure helpers below can be required by tests without parsing argv/exiting).
let APPLY = false;
let companyId = null;

// ── mapping: value → { icon, color } (reviewed table; keyword fallback below) ──
const DEFAULT_COLOR = '#2F3990';
const DEFAULT_ICON = 'mdi:checkbox-marked-circle-outline';
const VALUE_MAP = {
    task: ['checkbox-marked-circle-outline', '#2F3990'],
    sub_task: ['subdirectory-arrow-right', '#9CA3AF'],
    bug: ['bug', '#DC2626'],
    design: ['palette', '#F76808'],
    bid: ['gavel', '#0EA5E9'],
    invitation: ['email-outline', '#8B5CF6'],
    existing_client: ['account-check-outline', '#059669'],
    client_meeting: ['calendar-account', '#0D9488'],
    discussion: ['forum-outline', '#6366F1'],
    leads: ['bullseye-arrow', '#F59E0B'],
    to_do: ['format-list-checks', '#64748B'],
    training_task: ['school-outline', '#7C3AED'],
    admin: ['shield-account-outline', '#475569'],
    'user_interface_(ui)': ['monitor-dashboard', '#2563EB'],
    'user_experience_(ux)': ['gesture-tap', '#DB2777'],
    graphic_design: ['vector-square', '#F97316'],
    branding: ['fingerprint', '#E11D48'],
    web_design: ['web', '#0891B2'],
    print_design: ['printer-outline', '#7C3AED'],
    motion_graphics: ['movie-open-outline', '#C026D3'],
    'photography/videography': ['camera-outline', '#0284C7'],
    content_creation: ['pencil-outline', '#16A34A'],
    storyboarding: ['filmstrip', '#9333EA'],
    'feedback_&_revision': ['comment-edit-outline', '#EA580C'],
    financial_analysis: ['chart-line', '#059669'],
    bookkeeping: ['notebook-outline', '#0D9488'],
    auditing: ['clipboard-check-outline', '#CA8A04'],
    taxation: ['calculator-variant-outline', '#B45309'],
    financial_reporting: ['file-chart-outline', '#2563EB'],
    cost_management: ['cash-minus', '#DC2626'],
    cash_management: ['cash-multiple', '#16A34A'],
    engagement_tasks: ['handshake-outline', '#DB2777'],
    collaboration_tasks: ['account-multiple-outline', '#0EA5E9'],
    support_tasks: ['lifebuoy', '#0891B2'],
    content_creation_tasks: ['pencil-box-outline', '#16A34A'],
    in_progress: ['progress-clock', '#F59E0B'],
    in_review: ['eye-check-outline', '#6366F1'],
    backlog: ['format-list-bulleted', '#64748B'],
    approved: ['check-decagram-outline', '#16A34A'],
    done: ['check-circle-outline', '#16A34A'],
    complete: ['check-all', '#059669'],
    backlog_refinement: ['playlist-edit', '#7C3AED'],
    development: ['code-tags', '#2563EB'],
    sprint_planning: ['calendar-check-outline', '#0D9488'],
    optimization: ['speedometer', '#EA580C'],
    image: ['image-outline', '#0EA5E9'],
    // ── dev-company values (664d…) ─────────────────────────────────────────
    test: ['test-tube', '#7C3AED'],
    testing: ['test-tube', '#0D9488'],
    qa: ['clipboard-check-outline', '#CA8A04'],
    backlog_grooming: ['playlist-check', '#8B5CF6'],
    feature_development: ['source-branch', '#2563EB'],
    code_review: ['eye-check-outline', '#6366F1'],
    bug_fixing: ['bug-check-outline', '#DC2626'],
    integration: ['merge', '#0891B2'],
    feedback_collection: ['comment-quote-outline', '#EA580C'],
    story: ['bookmark-outline', '#16A34A'],
    epic: ['flag-outline', '#9333EA'],
    subtask: ['subdirectory-arrow-right', '#9CA3AF'],
    feature: ['star-outline', '#F59E0B'],
    content: ['text-box-outline', '#16A34A'],
    // engineering
    'ui/ux': ['palette-swatch-outline', '#DB2777'],
    frontend: ['language-html5', '#2563EB'],
    backend: ['server', '#7C3AED'],
    admin_panel: ['view-dashboard-outline', '#475569'],
    database: ['database', '#0D9488'],
    devops: ['infinity', '#EA580C'],
    shopify_task: ['storefront-outline', '#16A34A'],
    mobile: ['cellphone', '#0EA5E9'],
    // legal
    litigation_support: ['scale-balance', '#B45309'],
    contract_review: ['file-sign', '#CA8A04'],
    document_drafting: ['file-document-edit-outline', '#0D9488'],
    legal_research: ['book-search-outline', '#7C3AED'],
    // junk/test placeholders → neutral
    ddddsee334434: ['help-circle-outline', '#9CA3AF'],
    demo_25: ['help-circle-outline', '#9CA3AF'],
};
// Keyword fallback for any value/name not in VALUE_MAP.
const KEYWORD = [
    ['bug', 'bug', '#DC2626'], ['sub task', 'subdirectory-arrow-right', '#9CA3AF'],
    ['subtask', 'subdirectory-arrow-right', '#9CA3AF'], ['design', 'palette', '#F76808'],
    ['story', 'bookmark-outline', DEFAULT_COLOR], ['epic', 'flag-outline', DEFAULT_COLOR],
    ['feature', 'star-outline', DEFAULT_COLOR], ['research', 'magnify', DEFAULT_COLOR],
    ['test', 'test-tube', DEFAULT_COLOR], ['review', 'eye-check-outline', '#6366F1'],
    ['doc', 'file-document-outline', DEFAULT_COLOR], ['meeting', 'account-group-outline', '#0D9488'],
    ['task', 'checkbox-marked-circle-outline', DEFAULT_COLOR],
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
function withIcon(entry) {
    const { icon, color } = mapFor(entry);
    return { ...entry, iconType: 'library', iconValue: icon, iconColor: color };
}
const isBadKey = (k) => !Number.isInteger(k); // NaN, undefined, doubles, objects

/**
 * Normalize one taskTypeCounts array in two passes:
 *   1. MERGE same-value duplicates → one keeper (prefer entry with an icon, then
 *      lowest valid key, then first); the rest are dropped. Tasks pointing at a
 *      dropped entry are consolidated onto the keeper's key (done in the caller,
 *      matching by value).
 *   2. RE-KEY: give any keeper with a NaN/duplicate key a fresh unique integer;
 *      keepers with a valid, unclaimed key retain it (no task rewrite needed).
 * Returns { entries, changes:[{value,old,new}], merges:[{value,kept,droppedCount}], valueToKey }.
 */
function rekey(entries) {
    // Pass 1 — merge by value (case-insensitive), preserving first-seen order.
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
    // Pass 2 — unique keys for the keepers.
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

// ── report accumulator ──────────────────────────────────────────────────────
const report = {
    projects: [], statusLikeUsage: {}, orphanTotal: 0, taskRewriteTotal: 0,
    keyFixTotal: 0, iconSetTotal: 0, mergeTotal: 0,
};

async function crud(type, data, method) {
    return MongoDbCrudOpration(companyId, { type, data }, method).catch((e) => {
        throw new Error(`${method} ${type}: ${e && e.message ? e.message : e}`);
    });
}

async function run() {
    console.log(`\n=== Task-type migration — company ${companyId} — ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`);

    // ── Workstream B: per-project key repair + task rewrite (by value) ────────
    const projects = await crud(SCHEMA_TYPE.PROJECTS,
        [{ 'taskTypeCounts.0': { $exists: true } }, { ProjectName: 1, taskTypeCounts: 1 }], 'find');

    for (const p of projects || []) {
        const pid = String(p._id);
        const original = Array.isArray(p.taskTypeCounts) ? p.taskTypeCounts : [];
        const { entries, changes, merges } = rekey(original);

        // Task rewrites: for each FINAL entry, count tasks of that value whose key
        // differs from the entry's key. This subsumes both re-keys AND merges
        // (tasks pointing at a dropped duplicate get consolidated onto the keeper).
        const rewrites = [];
        for (const e of entries) {
            const n = await crud(SCHEMA_TYPE.TASKS,
                [{ ProjectID: pid, TaskType: e.value, TaskTypeKey: { $ne: e.key } }], 'countDocuments');
            if (n > 0) { rewrites.push({ value: e.value, key: e.key, tasks: n }); report.taskRewriteTotal += n; }
        }

        // Orphans: tasks whose TaskType matches no keeper value (left untouched).
        const values = entries.map((e) => e.value).filter(Boolean);
        const orphans = await crud(SCHEMA_TYPE.TASKS,
            [{ ProjectID: pid, TaskType: { $nin: values } }], 'countDocuments');
        report.orphanTotal += orphans;

        // Status-like usage in this project.
        for (const e of entries) {
            if (STATUS_LIKE.has(String(e.value || '').toLowerCase())) {
                const n = await crud(SCHEMA_TYPE.TASKS, [{ ProjectID: pid, TaskType: e.value }], 'countDocuments');
                report.statusLikeUsage[e.value] = (report.statusLikeUsage[e.value] || 0) + n;
            }
        }

        report.keyFixTotal += changes.length;
        report.mergeTotal += merges.reduce((s, m) => s + m.droppedCount, 0);
        if (changes.length || merges.length || rewrites.length || orphans) {
            report.projects.push({ project: p.ProjectName, pid, changes, merges, rewrites, orphans });
        }

        if (APPLY) {
            const finalEntries = entries.map(withIcon); // deduped + re-keyed + icons
            report.iconSetTotal += finalEntries.length;
            await crud(SCHEMA_TYPE.PROJECTS, [{ _id: p._id }, { $set: { taskTypeCounts: finalEntries } }], 'updateOne');
            for (const r of rewrites) {
                await crud(SCHEMA_TYPE.TASKS,
                    [{ ProjectID: pid, TaskType: r.value, TaskTypeKey: { $ne: r.key } }, { $set: { TaskTypeKey: r.key } }], 'updateMany');
            }
        }
    }

    // ── Workstream A: catalog + templates (icons only; keys cosmetic) ─────────
    const settingsDoc = await crud(SCHEMA_TYPE.SETTINGS, [{ name: settingsCollectionDocs.TASK_TYPE }], 'findOne');
    const catalogCount = settingsDoc && Array.isArray(settingsDoc.settings) ? settingsDoc.settings.length : 0;
    const templates = await crud(SCHEMA_TYPE.TASK_TYPE_TEMPLATES, [{}], 'find');
    const templateEntryCount = (templates || []).reduce((s, t) => s + ((t.taskTypes || []).length), 0);

    if (APPLY) {
        if (settingsDoc && Array.isArray(settingsDoc.settings)) {
            const settings = settingsDoc.settings.map(withIcon);
            await crud(SCHEMA_TYPE.SETTINGS,
                [{ name: settingsCollectionDocs.TASK_TYPE }, { $set: { settings } }], 'updateOne');
            report.iconSetTotal += settings.length;
        }
        for (const t of templates || []) {
            if (!Array.isArray(t.taskTypes)) continue;
            const taskTypes = t.taskTypes.map(withIcon);
            await crud(SCHEMA_TYPE.TASK_TYPE_TEMPLATES, [{ _id: t._id }, { $set: { taskTypes } }], 'updateOne');
            report.iconSetTotal += taskTypes.length;
        }
    }

    // ── print report ─────────────────────────────────────────────────────────
    console.log(`Projects scanned:            ${(projects || []).length}`);
    console.log(`Projects with changes:       ${report.projects.length}`);
    console.log(`Duplicate entries merged:    ${report.mergeTotal}`);
    console.log(`Task-type key fixes:         ${report.keyFixTotal}`);
    console.log(`Tasks to re-key:             ${report.taskRewriteTotal}`);
    console.log(`Orphan tasks (untouched):    ${report.orphanTotal}`);
    console.log(`Catalog entries (settings):  ${catalogCount}   Template entries: ${templateEntryCount}`);
    console.log(`Icon/color fields ${APPLY ? 'set' : 'to set'}:     ${APPLY ? report.iconSetTotal : catalogCount + templateEntryCount + ' (+ project entries)'}`);

    if (Object.keys(report.statusLikeUsage).length) {
        console.log('\nStatus-like task types — usage (decision #1):');
        for (const [v, n] of Object.entries(report.statusLikeUsage)) console.log(`  ${v}: ${n} task(s)`);
    }
    if (report.projects.length) {
        console.log('\nPer-project changes:');
        for (const p of report.projects) {
            const bits = [];
            if (p.merges.length) bits.push(`${p.merges.reduce((s, m) => s + m.droppedCount, 0)} merged`);
            if (p.changes.length) bits.push(`${p.changes.length} re-keyed`);
            if (p.rewrites.length) bits.push(`${p.rewrites.reduce((s, r) => s + r.tasks, 0)} tasks`);
            if (p.orphans) bits.push(`${p.orphans} orphans`);
            console.log(`  • ${p.project} (${p.pid}) — ${bits.join(', ') || 'icons only'}`);
            p.merges.forEach((m) => console.log(`      merge ${m.value}: drop ${m.droppedCount} dup(s), keep key ${JSON.stringify(m.kept)}`));
            p.changes.forEach((c) => console.log(`      re-key ${c.value}: ${JSON.stringify(c.old)} → ${c.new}`));
            p.rewrites.forEach((r) => console.log(`      rewrite ${r.value} → key ${r.key}: ${r.tasks} task(s)`));
        }
    }
    console.log(`\n${APPLY ? '✓ APPLIED.' : 'DRY-RUN complete — nothing written.'} ${APPLY ? 'Now clear caches: tasktype:' + companyId + ', taskTypeTemplate:' + companyId + ', UserProjectData:*' : 'Re-run with --apply after backup.'}\n`);
}

// Pure helpers exported for testing; DB-touching run() only executes as a CLI.
module.exports = { rekey, mapFor, withIcon, isBadKey, VALUE_MAP, STATUS_LIKE };

if (require.main === module) {
    const argv = process.argv.slice(2);
    APPLY = argv.includes('--apply');
    const i = argv.indexOf('--company');
    companyId = i !== -1 ? argv[i + 1] : null;
    if (!companyId) {
        console.error('ERROR: --company <companyId> is required.');
        process.exit(1);
    }
    run().then(() => process.exit(0)).catch((e) => {
        console.error('\nMIGRATION FAILED:', e && e.message ? e.message : e);
        process.exit(1);
    });
}
