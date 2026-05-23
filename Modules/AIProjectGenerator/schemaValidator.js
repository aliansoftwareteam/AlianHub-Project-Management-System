/**
 * Schema for the AI Project Generator's plan output.
 *
 * Phase A design notes:
 * - NO folder layer. Plans go: project → sprints[] → tasks[]. This matches
 *   the manual wizard's hierarchy (Project → Sprint → Task → Sub-task).
 *   Sub-tasks are not yet emitted by this stage; they ship in Phase B.
 *
 * - NO numerical count constraints on sprints, tasks, statuses, or task
 *   types. The prompt frames quality positively ("a shippable slice",
 *   "covers the full lifecycle"); the schema only enforces structural
 *   integrity and a few high safety caps so a runaway response is bounded.
 *
 * - Task descriptions are Editor.js blocks (`descriptionBlocks`) — the
 *   same shape the manual flow stores in `descriptionBlock`. The orchestrator
 *   wraps them with `{ time, version, blocks }` and derives `rawDescription`
 *   from the block text. We validate the 5-block skeleton presence so the
 *   model can't return a single-paragraph stub.
 */
'use strict';

const { z } = require('zod');

const HEX_COLOR = /^#?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

// Permissive date parsing — the LLM commonly emits "YYYY-MM-DD" rather
// than a full ISO timestamp. Both shapes are fine for us — the orchestrator
// coerces every accepted value through `new Date(...)`. We reject only
// strings JS itself can't parse, so we get loud validation when the model
// invents "2026-Q3" or similar.
const DateLike = z.union([
    z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
        message: 'date must be parseable (YYYY-MM-DD or ISO 8601 datetime)',
    }),
    z.null(),
]);

// ─── Status / task type entries ────────────────────────────────────────
//
// `type` must be one of three exact values so the orchestrator can find
// the "first" status (default_active) and the terminal one (close). The
// prompt is explicit about this; the schema enforces it.
const StatusTypeEnum = z.enum(['default_active', 'active', 'close']);

const StatusEntrySchema = z.object({
    name: z.string().min(1).max(40),
    textColor: z.string().regex(HEX_COLOR).optional(),
    type: StatusTypeEnum,
    // bgColor / backgroundColor / key are accepted if emitted but the
    // orchestrator derives them — keeping them optional means an over-eager
    // model that includes extras doesn't fail validation.
    bgColor: z.string().regex(HEX_COLOR).optional(),
    backgroundColor: z.string().regex(HEX_COLOR).optional(),
    key: z.union([z.string(), z.number()]).optional(),
});

const TaskTypeSchema = z.object({
    name: z.string().min(1).max(40),
    key: z.union([z.number(), z.string()]).optional(),
});

// ─── Editor.js block validation ────────────────────────────────────────
//
// We accept the three block types the prompt teaches: paragraph, header
// (level 4 only), and list (ordered | unordered). Other shapes are
// rejected so we don't surprise the renderer with a block type the
// frontend doesn't know how to draw.
const ParagraphBlock = z.object({
    type: z.literal('paragraph'),
    data: z.object({ text: z.string().min(1).max(4000) }),
});

const HeaderBlock = z.object({
    type: z.literal('header'),
    data: z.object({
        text: z.string().min(1).max(120),
        level: z.literal(4),
    }),
});

const ListBlock = z.object({
    type: z.literal('list'),
    data: z.object({
        style: z.enum(['ordered', 'unordered']),
        items: z.array(z.string().min(1).max(1000)).min(1).max(30),
    }),
});

const DescriptionBlock = z.discriminatedUnion('type', [
    ParagraphBlock,
    HeaderBlock,
    ListBlock,
]);

const TaskSchema = z.object({
    TaskName: z.string().min(2).max(200),
    descriptionBlocks: z.array(DescriptionBlock).min(5).max(20),
    TaskTypeKey: z.union([z.number(), z.string()]).optional(),
    status: z.string().min(1).max(40),
    DueDate: DateLike.optional(),
    AssigneeUserId: z.array(z.string()).default([]),
    priority: z.enum(['Low', 'Medium', 'High', 'Urgent']),
    estimatedHours: z.number().nonnegative().nullable().optional(),
}).superRefine((task, ctx) => {
    // Verify the 5-block skeleton:
    //   [0] paragraph (context)
    //   [1] header  "What to do"
    //   [2] list    (ordered, steps)
    //   [3] header  "Acceptance criteria"
    //   [4] list    (unordered, criteria)
    // Optional [5+]: additional paragraph blocks (e.g. "Depends on: ...").
    const b = task.descriptionBlocks;
    const issue = (msg) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg, path: ['descriptionBlocks'] });

    if (b[0]?.type !== 'paragraph') issue('first block must be a paragraph (context)');
    if (b[1]?.type !== 'header' || b[1]?.data?.text?.toLowerCase().trim() !== 'what to do') {
        issue('second block must be a header with text "What to do"');
    }
    if (b[2]?.type !== 'list' || b[2]?.data?.style !== 'ordered') {
        issue('third block must be an ordered list (the steps)');
    }
    if (b[3]?.type !== 'header' || b[3]?.data?.text?.toLowerCase().trim() !== 'acceptance criteria') {
        issue('fourth block must be a header with text "Acceptance criteria"');
    }
    if (b[4]?.type !== 'list' || b[4]?.data?.style !== 'unordered') {
        issue('fifth block must be an unordered list (acceptance criteria)');
    }
});

const SprintSchema = z.object({
    sprintName: z.string().min(1).max(80),
    // Safety cap only: 100 tasks per sprint is an absurd ceiling no honest
    // plan reaches. Lets us bound runaway responses without imposing a
    // count constraint the prompt is intentionally silent about.
    tasks: z.array(TaskSchema).min(1).max(100),
});

const ProjectSchema = z.object({
    ProjectName: z.string().min(3).max(80),
    // ProjectCode is server-generated. Kept optional in case the model
    // emits one — the orchestrator overrides it.
    ProjectCode: z.string().regex(/^[A-Z0-9]{2,6}$/).optional(),
    description: z.string().min(10).max(2000).optional().default(''),
    projectIcon: z.object({
        emoji: z.string().min(1).max(8).optional(),
        backgroundColor: z.string().regex(HEX_COLOR).optional(),
    }).default({ emoji: '🚀', backgroundColor: '#6473E8' }),
    DueDate: DateLike.optional(),
    isPrivateSpace: z.boolean().default(false),
    ProjectType: z.string().min(1).max(60).optional().default('Fix'),

    // No min/max — the AI decides per project. Safety caps only.
    projectStatusData: z.array(StatusEntrySchema).min(1).max(20),
    taskStatusData: z.array(StatusEntrySchema).min(1).max(20),
    taskTypeCounts: z.array(TaskTypeSchema).min(1).max(20),

    // The AI may emit apps for completeness but the orchestrator ignores
    // them — apps come from company defaults. Accepted-but-not-required.
    apps: z.array(z.object({
        key: z.string().min(1).max(50),
        name: z.string().min(1).max(50),
    })).optional(),

    LeadUserId: z.array(z.string()).default([]),
}).superRefine((proj, ctx) => {
    const issue = (path, msg) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg, path });

    // Exactly one default_active + one close on each status list.
    const checkExactlyOne = (list, type, listName) => {
        const matches = list.filter((s) => s.type === type);
        if (matches.length === 0) issue([listName], `must contain exactly one entry with type "${type}"`);
        if (matches.length > 1) issue([listName], `must contain exactly one entry with type "${type}" (found ${matches.length})`);
    };
    checkExactlyOne(proj.projectStatusData, 'default_active', 'projectStatusData');
    checkExactlyOne(proj.projectStatusData, 'close', 'projectStatusData');
    checkExactlyOne(proj.taskStatusData, 'default_active', 'taskStatusData');
    checkExactlyOne(proj.taskStatusData, 'close', 'taskStatusData');

    // Status names within each list must be unique (case-insensitive) so
    // the orchestrator's name-keyed lookup doesn't silently collide.
    const dupesIn = (list, listName) => {
        const seen = new Set();
        for (const s of list) {
            const key = String(s.name || '').toLowerCase().trim();
            if (seen.has(key)) issue([listName], `duplicate status name "${s.name}"`);
            seen.add(key);
        }
    };
    dupesIn(proj.projectStatusData, 'projectStatusData');
    dupesIn(proj.taskStatusData, 'taskStatusData');
    dupesIn(proj.taskTypeCounts, 'taskTypeCounts');
});

const PlanSchema = z.object({
    project: ProjectSchema,
    // Safety cap only: 200 sprints is far beyond any honest plan.
    sprints: z.array(SprintSchema).min(1).max(200),
}).superRefine((plan, ctx) => {
    const issue = (msg, path) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg, path: path || [] });

    // Every task.status must reference a taskStatusData[].name (case-sensitive,
    // exactly as the LLM emitted it — orchestrator's lookup is by lowercase
    // but we want the model to learn that names are real identifiers).
    const statusNames = new Set(plan.project.taskStatusData.map((s) => s.name));
    plan.sprints.forEach((sprint, si) => {
        sprint.tasks.forEach((task, ti) => {
            if (!statusNames.has(task.status)) {
                issue(
                    `Task "${task.TaskName}" has status "${task.status}" which is not in taskStatusData.`,
                    ['sprints', si, 'tasks', ti, 'status'],
                );
            }
        });
    });

    // Every task.TaskTypeKey must reference a taskTypeCounts[].key.
    const typeKeys = new Set(plan.project.taskTypeCounts.map((t) => String(t.key)));
    plan.sprints.forEach((sprint, si) => {
        sprint.tasks.forEach((task, ti) => {
            if (task.TaskTypeKey == null) return; // optional — orchestrator falls back to first type
            if (!typeKeys.has(String(task.TaskTypeKey))) {
                issue(
                    `Task "${task.TaskName}" has TaskTypeKey ${task.TaskTypeKey} which is not in taskTypeCounts.`,
                    ['sprints', si, 'tasks', ti, 'TaskTypeKey'],
                );
            }
        });
    });

    // Hard safety cap on total tasks: 2000. This is an absurdly large
    // number for any honest plan — purely to bound a runaway response.
    const total = plan.sprints.reduce((acc, s) => acc + s.tasks.length, 0);
    if (total > 2000) {
        issue(`Plan has ${total} tasks; safety cap is 2000.`);
    }
});

const ClarifyResponseSchema = z.object({
    needsClarification: z.literal(false),
    plan: PlanSchema,
});

/**
 * Strip ids that aren't in the allowed member list. Returns a cleaned plan
 * plus a list of removed ids for logging.
 *
 * @param {object} plan        - PlanSchema-validated plan.
 * @param {Set<string>} allowedIds - Valid company user ids.
 */
function sanitizeMemberIds(plan, allowedIds) {
    const removed = [];
    const filterIds = (arr, label) => {
        if (!Array.isArray(arr)) return [];
        const kept = [];
        for (const id of arr) {
            if (allowedIds.has(String(id))) {
                kept.push(String(id));
            } else {
                removed.push({ label, id });
            }
        }
        return kept;
    };
    plan.project.LeadUserId = filterIds(plan.project.LeadUserId, 'project.LeadUserId');
    for (const sprint of plan.sprints) {
        for (const task of sprint.tasks) {
            task.AssigneeUserId = filterIds(task.AssigneeUserId, `task:${task.TaskName}`);
        }
    }
    return { plan, removed };
}

/**
 * Tolerant JSON extraction:
 *   - Strips ``` and ```json fences if present.
 *   - Slices from first `{` to last `}` so any prose around the JSON is dropped.
 *   - JSON.parse the result.
 */
function tryParseJson(raw) {
    if (typeof raw !== 'string') return { ok: false, error: 'not a string' };
    let text = raw.trim();
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        text = text.slice(firstBrace, lastBrace + 1);
    }
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = {
    PlanSchema,
    ClarifyResponseSchema,
    sanitizeMemberIds,
    tryParseJson,
};
