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
const { MAX_TASK_HOURS } = require('./planRules');

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

// Sub-task (AI-Assist "Break tasks into sub-tasks"). Lightweight on purpose —
// just a name + optional priority; it is created under its parent task and
// needs no 5-block description.
const SubTaskSchema = z.object({
    TaskName: z.string().min(2).max(200),
    // A sub-task exists to carry a slice of work that did not fit the two-hour
    // cap, so it needs its own estimate — the parent deliberately carries none.
    estimatedHours: z.number().positive().max(MAX_TASK_HOURS).nullable().optional(),
    // Sub-tasks get a real (but short) description — a paragraph, optionally a
    // brief steps list — not the full task "What to do / Acceptance criteria"
    // 5-block skeleton. min(1) so a sub-task is never created description-less.
    descriptionBlocks: z.array(DescriptionBlock).min(1).max(20),
    priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(),
});

const TaskSchema = z.object({
    TaskName: z.string().min(2).max(200),
    // Optional temp id the model assigns so links can reference this task
    // before real _ids exist. Never persisted to the task doc.
    ref: z.string().min(1).max(60).optional(),
    // Optional epic this task belongs to (AI-Assist "Organize into epics"),
    // referencing a plan epic's `ref`.
    epicRef: z.string().min(1).max(60).optional(),
    // Optional custom-field values (AI-Assist "Add custom fields"), each
    // referencing a plan field's `ref`.
    fieldValues: z.array(z.object({
        fieldRef: z.string().min(1).max(60),
        value: z.union([z.string(), z.number(), z.boolean()]),
    })).max(50).optional(),
    descriptionBlocks: z.array(DescriptionBlock).min(5).max(20),
    TaskTypeKey: z.union([z.number(), z.string()]).optional(),
    status: z.string().min(1).max(40),
    DueDate: DateLike.optional(),
    AssigneeUserId: z.array(z.string()).default([]),
    priority: z.enum(['Low', 'Medium', 'High', 'Urgent']),
    // Capped, not merely requested: a plan that breaks the company rule is
    // rejected here and goes back for repair rather than being created.
    estimatedHours: z.number().nonnegative().max(MAX_TASK_HOURS).nullable().optional(),
    // Optional sub-tasks created under this task (AI-Assist).
    subtasks: z.array(SubTaskSchema).max(20).optional(),
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

    // Company rule: work too big for one task is split, and the hours then live
    // on the sub-tasks. Enforced rather than merely asked for — the sub-tasks
    // are deliberately skipped by the background estimator, so a sub-task the
    // model forgot to estimate would stay at zero for good, and a parent that
    // kept its own estimate would count the same work twice in every roll-up.
    if (Array.isArray(task.subtasks) && task.subtasks.length) {
        if (Number(task.estimatedHours) > 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Task "${task.TaskName}" has sub-tasks, so it must not carry its own estimatedHours — put the hours on the sub-tasks.`,
                path: ['estimatedHours'],
            });
        }
        task.subtasks.forEach((sub, i) => {
            if (!(Number(sub.estimatedHours) > 0)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Sub-task "${sub.TaskName}" needs its own estimatedHours (at most ${MAX_TASK_HOURS}).`,
                    path: ['subtasks', i, 'estimatedHours'],
                });
            }
        });
    }

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
    // Accepted so the model's picks survive into the plan and can be pre-ticked
    // on review. The execute request is authoritative and filters against the
    // company list, so a slug invented here is never persisted.
    skills: z.array(z.string().min(1).max(60)).max(15).optional().default([]),

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

// ─── Tasks-into-existing-project plan ──────────────────────────────────
//
// For the "AI Assistant for task creation" flow (AHE-3777): the project
// already exists, with its statuses and task types. So the plan is sprints
// + tasks ONLY — no project / status / type invention. Reuses SprintSchema
// (and thus TaskSchema, including the 5-block description skeleton). The
// orchestrator forces new tasks into the project's first status column and
// falls back to its first task type, so task.status / TaskTypeKey are
// advisory; we only enforce structure + the total-task safety cap here.
// A dependency link between two tasks, by their plan `ref`s (AI-Assist "Link
// related tasks"). Resolved to real task ids after creation.
const LinkSchema = z.object({
    from: z.string().min(1).max(60),
    to: z.string().min(1).max(60),
    type: z.enum(['blocks', 'blocked_by', 'duplicates', 'duplicated_by', 'relates_to']).default('relates_to'),
});

// An epic to create in the project (AI-Assist "Organize into epics"). Tasks
// reference it by `ref` via their `epicRef`. Resolved to a real epic id.
const EpicSchema = z.object({
    ref: z.string().min(1).max(60),
    name: z.string().min(1).max(120),
    color: z.string().regex(HEX_COLOR).optional(),
});

// A custom field to create in the project (AI-Assist "Add custom fields").
// Tasks set values via fieldValues -> fieldRef. Resolved to a real field id.
const CustomFieldSchema = z.object({
    ref: z.string().min(1).max(60),
    title: z.string().min(1).max(80),
    type: z.enum(['text', 'textarea', 'number', 'date', 'money', 'email', 'phone', 'checkbox', 'dropdown']),
    options: z.array(z.string().min(1).max(80)).max(30).optional(),
});

const TasksPlanSchema = z.object({
    sprints: z.array(SprintSchema).min(1).max(200),
    links: z.array(LinkSchema).max(500).optional(),
    epics: z.array(EpicSchema).max(50).optional(),
    customFields: z.array(CustomFieldSchema).max(30).optional(),
}).superRefine((plan, ctx) => {
    const total = plan.sprints.reduce((acc, s) => acc + s.tasks.length, 0);
    if (total > 2000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Plan has ${total} tasks; safety cap is 2000.`, path: [] });
    }
});

const TasksResponseSchema = z.object({
    needsClarification: z.literal(false),
    plan: TasksPlanSchema,
});

// ─── Tasks-only plan (flat list → an existing sprint) ──────────────────
//
// Mode "tasks": the user is adding tasks to ONE existing sprint, so there
// are no sprints to create — just a flat list of tasks (same TaskSchema,
// 5-block descriptions and all). The orchestrator places them into the
// chosen sprint. 200 is a generous safety cap.
const TasksOnlyPlanSchema = z.object({
    tasks: z.array(TaskSchema).min(1).max(200),
    links: z.array(LinkSchema).max(500).optional(),
    epics: z.array(EpicSchema).max(50).optional(),
    customFields: z.array(CustomFieldSchema).max(30).optional(),
});

const TasksOnlyResponseSchema = z.object({
    needsClarification: z.literal(false),
    plan: TasksOnlyPlanSchema,
});

// ─── Sprints-only plan (sprint names, no tasks) ────────────────────────
//
// Mode "sprints": the user only wants sprint structure created in the
// project. Each entry is just a name — NO tasks.
const SprintNameOnlySchema = z.object({
    sprintName: z.string().min(1).max(80),
});

const SprintsOnlyPlanSchema = z.object({
    sprints: z.array(SprintNameOnlySchema).min(1).max(50),
});

const SprintsOnlyResponseSchema = z.object({
    needsClarification: z.literal(false),
    plan: SprintsOnlyPlanSchema,
});

// ─── Clarifying questions schema ───────────────────────────────────────
//
// Validates the JSON output of the clarify LLM call (before plan
// generation). The shape is intentionally permissive — `recommended` can
// be a string, array, or boolean depending on `type` — so each question
// is refined post-hoc with `superRefine` to enforce per-type rules.

// Categories are the eight mandatory ones the clarify call MUST cover for
// every brief. Display order in the UI follows this declaration order
// (Platform first, Compliance last). Values are stable snake_case ids;
// the frontend maps them to emoji-prefixed display labels.
const QuestionCategoryEnum = z.enum([
    'platform',        // 🖥️  Where users access the product
    'features',        // ✨ What is in v1 / out of scope
    'tech_stack',      // 🛠️  Frameworks, languages, databases, hosting
    'integrations',    // 💳 Payments, auth, CRM, analytics, 3rd-party APIs
    'audience',        // 👥 Who uses it, scale, public vs. internal
    'timeline',        // 📅 Launch window, phased rollout
    'budget',          // 💰 Spend tier for APIs, infra, tooling
    'compliance',      // 🌍 Regulatory, regional, accessibility, data residency
]);

const QuestionTypeEnum = z.enum([
    'segmented',
    'radio_cards',
    'toggle_chips',
    'toggle',
    'preset_chips',
    'text',
    'select_card',
]);

const QuestionOptionSchema = z.object({
    value: z.string().min(1).max(60),
    label: z.string().min(1).max(80),
    description: z.string().max(200).optional(),
});

// The five points a brief must cover before it is planned (task 015). Keys
// are stable ids shared with the frontend; order is the order the brief's
// sections are rendered in.
const COVERAGE_POINTS = ['what_for_whom', 'done_when', 'existing', 'constraints', 'team'];
const CoveragePointEnum = z.enum(COVERAGE_POINTS);
const CoverageStateEnum = z.enum(['met', 'missing']);

const CoverageMapSchema = z.object({
    what_for_whom: CoverageStateEnum,
    done_when: CoverageStateEnum,
    existing: CoverageStateEnum,
    constraints: CoverageStateEnum,
    team: CoverageStateEnum,
});

const CoverageSchema = z.object({
    coverage: CoverageMapSchema,
    notes: z.object({
        what_for_whom: z.string().max(300).optional().default(''),
        done_when: z.string().max(300).optional().default(''),
        existing: z.string().max(300).optional().default(''),
        constraints: z.string().max(300).optional().default(''),
        team: z.string().max(300).optional().default(''),
    }).optional().default({}),
});

const ClarifyQuestionSchema = z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, 'id must be kebab-case, 1–41 chars'),
    point: CoveragePointEnum,
    category: QuestionCategoryEnum.optional().default('features'),
    question: z.string().min(5).max(240),
    rationale: z.string().max(280).optional().default(''),
    required: z.boolean().default(false),
    type: QuestionTypeEnum,
    options: z.array(QuestionOptionSchema).max(8).optional(),
    // `recommended` is type-dependent: string for single-choice, string[]
    // for multi, boolean for toggle, absent for text. We accept the union
    // and validate the per-type shape in superRefine.
    recommended: z.union([z.string(), z.array(z.string()), z.boolean()]).optional(),
    hint: z.string().max(280).optional().default(''),
}).superRefine((q, ctx) => {
    const issue = (msg, path) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg, path: path || [] });

    const needsOptions = ['segmented', 'radio_cards', 'select_card', 'toggle_chips', 'preset_chips'].includes(q.type);
    if (needsOptions) {
        if (!Array.isArray(q.options) || q.options.length < 2) {
            issue(`type "${q.type}" requires at least 2 options`, ['options']);
            return;
        }
        // Option values must be unique within the question.
        const seen = new Set();
        for (const opt of q.options) {
            if (seen.has(opt.value)) issue(`duplicate option value "${opt.value}"`, ['options']);
            seen.add(opt.value);
        }
    }

    if (q.type === 'toggle' && q.options) {
        issue('type "toggle" must not include options', ['options']);
    }
    if (q.type === 'text' && q.options) {
        issue('type "text" must not include options', ['options']);
    }

    // recommended shape per type
    if (q.recommended != null) {
        const validValues = needsOptions ? new Set(q.options.map((o) => o.value)) : null;
        if (q.type === 'toggle_chips') {
            if (!Array.isArray(q.recommended)) {
                issue('recommended must be an array for type "toggle_chips"', ['recommended']);
            } else {
                for (const v of q.recommended) {
                    if (!validValues || !validValues.has(v)) {
                        issue(`recommended value "${v}" is not in options`, ['recommended']);
                    }
                }
            }
        } else if (q.type === 'toggle') {
            if (typeof q.recommended !== 'boolean') {
                issue('recommended must be a boolean for type "toggle"', ['recommended']);
            }
        } else if (q.type === 'text') {
            // No structured recommendation for free text.
            if (typeof q.recommended !== 'string') {
                issue('recommended for type "text" must be a string suggestion or omitted', ['recommended']);
            }
        } else {
            // segmented / radio_cards / select_card / preset_chips
            if (typeof q.recommended !== 'string') {
                issue(`recommended must be a string for type "${q.type}"`, ['recommended']);
            } else if (validValues && !validValues.has(q.recommended)) {
                issue(`recommended value "${q.recommended}" is not in options`, ['recommended']);
            }
        }
    }
});

const ClarifyQuestionsSchema = z.object({
    understanding: z.string().max(400).optional().default(''),
    // 14-question cap: enough room for a full tech-stack breakdown (one
    // question per layer — frontend, backend, db, storage, deployment,
    // ci/cd) plus the scope/audience/timeline/quality/budget questions a
    // CTO would also ask. Most briefs return 5–8 questions; the cap is
    // only for tech-heavy briefs that genuinely need the breakdown.
    questions: z.array(ClarifyQuestionSchema).max(14),
}).superRefine((doc, ctx) => {
    // Question ids must be globally unique within the questions array.
    const seen = new Set();
    doc.questions.forEach((q, i) => {
        if (seen.has(q.id)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `duplicate question id "${q.id}"`,
                path: ['questions', i, 'id'],
            });
        }
        seen.add(q.id);
    });
});

const BriefAssumptionSchema = z.object({
    point: z.enum([...COVERAGE_POINTS, 'other']),
    text: z.string().min(1).max(500),
    questionId: z.string().max(60).optional(),
});

const BriefDraftSchema = z.object({
    sections: z.object({
        what_for_whom: z.string().min(1).max(3000),
        done_when: z.string().min(1).max(3000),
        existing: z.string().min(1).max(3000),
        constraints: z.string().min(1).max(3000),
        team: z.string().min(1).max(3000),
    }),
    assumptions: z.array(BriefAssumptionSchema).max(30).default([]),
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
 * Member-id sanitizer for the tasks-only plan (no project.LeadUserId).
 * Drops AssigneeUserId values that aren't current company members.
 */
function sanitizeTaskPlanMemberIds(plan, allowedIds) {
    const removed = [];
    const filterIds = (arr, label) => {
        if (!Array.isArray(arr)) return [];
        const kept = [];
        for (const id of arr) {
            if (allowedIds.has(String(id))) kept.push(String(id));
            else removed.push({ label, id });
        }
        return kept;
    };
    if (Array.isArray(plan && plan.sprints)) {
        for (const sprint of plan.sprints) {
            for (const task of (sprint.tasks || [])) {
                task.AssigneeUserId = filterIds(task.AssigneeUserId, `task:${task.TaskName}`);
            }
        }
    }
    // Tasks-only plan carries a flat `tasks` array (no sprints).
    if (Array.isArray(plan && plan.tasks)) {
        for (const task of plan.tasks) {
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
    COVERAGE_POINTS,
    CoverageSchema,
    BriefDraftSchema,
    PlanSchema,
    ClarifyResponseSchema,
    ClarifyQuestionsSchema,
    TasksPlanSchema,
    TasksResponseSchema,
    TasksOnlyPlanSchema,
    TasksOnlyResponseSchema,
    SprintsOnlyPlanSchema,
    SprintsOnlyResponseSchema,
    sanitizeMemberIds,
    sanitizeTaskPlanMemberIds,
    tryParseJson,
};
