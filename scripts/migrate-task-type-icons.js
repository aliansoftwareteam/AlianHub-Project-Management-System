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
 * Re-key one taskTypeCounts array. Returns { entries, changes:[{value,old,new}],
 * valueToKey } where a "keeper" retains its (valid, first-seen) key and the rest
 * get fresh unique keys. No merges (distinct values assumed; dupes reported).
 */
function rekey(entries) {
    const claimed = new Set();
    let next = entries.reduce((m, e) => (Number.isInteger(e.key) && e.key > m ? e.key : m), 0);
    const changes = [];
    const valueToKey = {};
    const dupValues = [];
    const out = entries.map((e) => {
        const value = String(e.value || '');
        if (valueToKey[value.toLowerCase()] !== undefined) dupValues.push(value); // same-value dup
        let key = e.key;
        if (isBadKey(key) || claimed.has(key)) {
            key = ++next;
            changes.push({ value, old: e.key, new: key });
        }
        claimed.add(key);
        valueToKey[value.toLowerCase()] = key;
        return { ...e, key };
    });
    return { entries: out, changes, valueToKey, dupValues };
}

// ── report accumulator ──────────────────────────────────────────────────────
const report = {
    projects: [], statusLikeUsage: {}, orphanTotal: 0, taskRewriteTotal: 0,
    keyFixTotal: 0, iconSetTotal: 0, dupValueProjects: [],
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
        const { entries, changes, valueToKey, dupValues } = rekey(original);
        if (dupValues.length) report.dupValueProjects.push({ project: p.ProjectName, values: dupValues });

        // Tasks to rewrite: those whose type value's key changed. Match by value.
        const perValue = [];
        for (const ch of changes) {
            const n = await crud(SCHEMA_TYPE.TASKS,
                [{ ProjectID: pid, TaskType: ch.value }], 'countDocuments');
            perValue.push({ ...ch, tasks: n });
            report.taskRewriteTotal += n;
        }

        // Orphans: tasks whose TaskType matches no entry value (left untouched).
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
        if (changes.length || orphans) {
            report.projects.push({ project: p.ProjectName, pid, keyFixes: perValue, orphans });
        }

        if (APPLY) {
            // B: write corrected keys. A: also set icons on the same array (one write).
            const finalEntries = entries.map(withIcon);
            report.iconSetTotal += finalEntries.length;
            await crud(SCHEMA_TYPE.PROJECTS, [{ _id: p._id }, { $set: { taskTypeCounts: finalEntries } }], 'updateOne');
            for (const ch of changes) {
                await crud(SCHEMA_TYPE.TASKS,
                    [{ ProjectID: pid, TaskType: ch.value }, { $set: { TaskTypeKey: ch.new } }], 'updateMany');
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
    console.log(`Projects needing key fixes:  ${report.projects.filter((x) => x.keyFixes.length).length}`);
    console.log(`Total task-type key fixes:   ${report.keyFixTotal}`);
    console.log(`Total tasks to re-key:       ${report.taskRewriteTotal}`);
    console.log(`Orphan tasks (untouched):    ${report.orphanTotal}`);
    console.log(`Catalog entries (settings):  ${catalogCount}   Template entries: ${templateEntryCount}`);
    console.log(`Icon/color fields ${APPLY ? 'set' : 'to set'}:     ${APPLY ? report.iconSetTotal : catalogCount + templateEntryCount + '(+ project entries)'}`);

    if (Object.keys(report.statusLikeUsage).length) {
        console.log('\nStatus-like task types — usage (decision #1):');
        for (const [v, n] of Object.entries(report.statusLikeUsage)) console.log(`  ${v}: ${n} task(s)`);
    }
    if (report.dupValueProjects.length) {
        console.log('\n⚠ Same-value duplicates found (would need merge — review):');
        report.dupValueProjects.forEach((d) => console.log(`  ${d.project}: ${d.values.join(', ')}`));
    }
    if (report.projects.length) {
        console.log('\nPer-project key fixes:');
        for (const p of report.projects) {
            console.log(`  • ${p.project} (${p.pid})  orphans:${p.orphans}`);
            p.keyFixes.forEach((k) => console.log(`      ${k.value}: key ${JSON.stringify(k.old)} → ${k.new}  (${k.tasks} task(s))`));
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
