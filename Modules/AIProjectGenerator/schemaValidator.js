const { z } = require('zod');

const HEX_COLOR = /^#?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const PROJECT_CODE = /^[A-Z0-9]{2,6}$/;

// Permissive date accept-or-reject. The LLM commonly emits "YYYY-MM-DD"
// (plain date) instead of a full ISO timestamp. Both shapes are fine for
// us — the orchestrator coerces every accepted value through
// `safeIsoDate()` which calls `new Date(...)`. We reject only strings
// that JS itself can't parse, so we get loud validation when the model
// invents "2026-Q3" or similar.
const DateLike = z.union([
    z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
        message: 'date must be parseable (YYYY-MM-DD or ISO 8601 datetime)',
    }),
    z.null(),
]);

const StatusEntrySchema = z.object({
    name: z.string().min(1).max(40),
    bgColor: z.string().regex(HEX_COLOR).optional(),
    type: z.string().min(1).max(30).optional(),
    key: z.union([z.string(), z.number()]).optional(),
});

const TaskTypeSchema = z.object({
    name: z.string().min(1).max(40),
    key: z.union([z.number(), z.string()]).optional(),
    icon: z.string().optional(),
});

const AppSchema = z.object({
    key: z.string().min(1).max(50),
    name: z.string().min(1).max(50),
});

const TaskSchema = z.object({
    TaskName: z.string().min(2).max(200),
    description: z.string().min(20).max(4000),
    TaskTypeKey: z.union([z.number(), z.string()]).optional(),
    status: z.string().min(1).max(40),
    DueDate: DateLike.optional(),
    AssigneeUserId: z.array(z.string()).default([]),
    priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).nullable().optional(),
    estimatedHours: z.number().nonnegative().nullable().optional(),
});

const SprintSchema = z.object({
    sprintName: z.string().min(1).max(80),
    tasks: z.array(TaskSchema).min(0).max(50),
});

const FolderSchema = z.object({
    folderName: z.string().min(1).max(80),
    sprints: z.array(SprintSchema).min(1).max(10),
});

const ProjectSchema = z.object({
    ProjectName: z.string().min(3).max(80),
    ProjectCode: z.string().regex(PROJECT_CODE, 'ProjectCode must be 2-6 uppercase letters/digits'),
    description: z.string().min(10).max(2000).optional().default(''),
    projectIcon: z.object({
        emoji: z.string().min(1).max(8).optional(),
        backgroundColor: z.string().regex(HEX_COLOR).optional(),
    }).default({ emoji: '🚀', backgroundColor: '#6473E8' }),
    DueDate: DateLike.optional(),
    isPrivateSpace: z.boolean().default(false),
    ProjectType: z.string().min(1).max(60).optional().default('Fix'),
    projectStatusData: z.array(StatusEntrySchema).min(2).max(8),
    taskStatusData: z.array(StatusEntrySchema).min(2).max(8),
    taskTypeCounts: z.array(TaskTypeSchema).min(1).max(8),
    apps: z.array(AppSchema).min(0).max(20).default([]),
    LeadUserId: z.array(z.string()).default([]),
});

const PlanSchema = z.object({
    project: ProjectSchema,
    folders: z.array(FolderSchema).min(1).max(8),
}).superRefine((plan, ctx) => {
    let total = 0;
    for (const f of plan.folders) {
        for (const s of f.sprints) {
            total += s.tasks.length;
        }
    }
    if (total < 5) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Plan has only ${total} tasks; need at least 5.` });
    }
    if (total > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Plan has ${total} tasks; cap is 100.` });
    }

    // Every task.status must match one of project.taskStatusData[].name
    const statusNames = new Set(plan.project.taskStatusData.map((s) => s.name));
    for (const f of plan.folders) {
        for (const s of f.sprints) {
            for (const t of s.tasks) {
                if (!statusNames.has(t.status)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Task "${t.TaskName}" has status "${t.status}" not in taskStatusData.`,
                    });
                }
            }
        }
    }
});

const ClarifyResponseSchema = z.object({
    needsClarification: z.boolean(),
    questions: z.array(z.string().min(5).max(300)).max(5).optional(),
    plan: PlanSchema.optional(),
}).refine(
    (v) => v.needsClarification === true ? (Array.isArray(v.questions) && v.questions.length > 0) : !!v.plan,
    { message: 'Either provide non-empty questions OR a full plan' },
);

/**
 * Strip ids that aren't in the allowed member list. Returns a cleaned plan
 * plus a list of removed ids for logging.
 *
 * @param {object} plan - PlanSchema-validated plan.
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
    for (const f of plan.folders) {
        for (const s of f.sprints) {
            for (const t of s.tasks) {
                t.AssigneeUserId = filterIds(t.AssigneeUserId, `task:${t.TaskName}`);
            }
        }
    }
    return { plan, removed };
}

function tryParseJson(raw) {
    if (typeof raw !== 'string') return { ok: false, error: 'not a string' };
    let text = raw.trim();
    // Strip markdown fences if the model added them despite instructions.
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    }
    // Trim trailing prose after the first complete JSON object.
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
