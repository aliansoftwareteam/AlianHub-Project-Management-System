// AHE-3792 — the LLM-backed "Think" step.
//
// Reuses AlianHub's existing LLM provider abstraction
// (Modules/AIProjectGenerator/llmProvider — Anthropic / OpenAI / DeepSeek behind
// one interface). Given a READ-ONLY project snapshot (from
// perceive.buildProjectContext), it asks the model which tasks most need
// attention and what to say, then returns a VALIDATED plan of proposals.
//
// Safety: the model only DECIDES. Every returned action is constrained to a
// tiny allow-list (comment writes only) and to task ids that actually exist in
// the snapshot, so it can never invent a task or reach a risky action. The plan
// still flows through the dispatcher (gate → inbox / auto-run → audit) exactly
// like the deterministic skill — the LLM does not touch the database directly.

const { getProvider, isAnyProviderConfigured } = require('../AIProjectGenerator/llmProvider');

// The ONLY actions the model may propose (both are low-risk comment writes).
// Status / assign / create / deploy / delete are never exposed to the LLM.
const LLM_ALLOWED_ACTIONS = new Set(['post_task_comment', 'nudge_stale_task']);
const MAX_ACTIONS = 8;      // hard cap on how many proposals one review can emit
const CAP_PER_LIST = 15;    // bound the context we send per task list

const SYSTEM_PROMPT = [
    'You are the AlianHub AI Brain — an autonomous project-management assistant.',
    'You are given a READ-ONLY snapshot of ONE project: task counts plus lists of overdue, stale and unassigned tasks.',
    'Your job: decide which tasks most need a nudge right now, and write a short, specific, friendly comment for each.',
    '',
    'You may ONLY propose these two actions:',
    '- "post_task_comment": post a comment on a task (use for overdue tasks or anything needing attention).',
    '- "nudge_stale_task": post a gentle status-update request (use for tasks that have not moved).',
    '',
    'Rules:',
    `- Propose at most ${MAX_ACTIONS} actions. Prioritise the most impactful — do NOT comment on every task.`,
    '- Only use taskId values that appear in the snapshot. NEVER invent a task id.',
    '- Each message is one or two sentences, professional and specific to that task. No @mentions.',
    '- Never propose the same task twice.',
    '',
    'Respond with ONLY a JSON object of exactly this shape (no markdown, no prose):',
    '{"summary":"<one-sentence health read>","actions":[{"taskId":"<id from snapshot>","action":"post_task_comment|nudge_stale_task","message":"<comment text>","reason":"<why, shown to the human approver>"}]}',
].join('\n');

const dayStr = (d) => { try { return new Date(d).toISOString().slice(0, 10); } catch (e) { return null; } };

const slimTask = (t) => ({
    taskId: String(t._id),
    key: t.TaskKey || '',
    name: t.TaskName || '',
    status: t.statusType || '',
    dueDate: t.DueDate ? dayStr(t.DueDate) : null,
});

function buildUserMessage(ctx) {
    const snapshot = {
        project: (ctx.project && ctx.project.ProjectName) || '',
        totals: {
            tasks: ctx.list.length,
            byStatus: ctx.byStatus,
            overdue: ctx.overdue.length,
            stale: ctx.stale.length,
            unassigned: ctx.unassigned.length,
        },
        staleThresholdDays: ctx.staleDays,
        overdue: ctx.overdue.slice(0, CAP_PER_LIST).map(slimTask),
        stale: ctx.stale.slice(0, CAP_PER_LIST).map(slimTask),
        unassigned: ctx.unassigned.slice(0, CAP_PER_LIST).map(slimTask),
    };
    return `Here is the project snapshot. Decide the actions.\n\n${JSON.stringify(snapshot)}`;
}

// Tolerant JSON extraction — strip markdown fences and grab the outermost {...}.
function parseJson(text) {
    if (!text) return null;
    let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first === -1 || last === -1 || last < first) return null;
    try { return JSON.parse(s.slice(first, last + 1)); } catch (e) { return null; }
}

// Returns { summary, model, tokens, truncated, plan:[{actionKey,taskId,params,reason}] }.
// Throws (with a clear message) if no provider is configured or the LLM fails.
async function reviewProject(companyId, ctx) {
    if (!isAnyProviderConfigured()) {
        const e = new Error('No LLM provider is configured. Set ANTHROPIC_API_KEY+ANTHROPIC_MODEL (or AI_API_KEY+AI_MODEL / DEEPSEEK_API_KEY+DEEPSEEK_MODEL) to use the AI review.');
        e.code = 'LLM_NOT_CONFIGURED';
        throw e;
    }

    const provider = getProvider();
    const result = await provider.chat({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(ctx) }],
        jsonMode: true,
        maxTokens: 1500,
        temperature: 0.3,
    });

    const parsed = parseJson(result.content);
    if (!parsed || !Array.isArray(parsed.actions)) {
        throw new Error('The AI response could not be parsed into actions.');
    }

    // Validate every proposed action against the allow-list AND the real task
    // set — anything unrecognised or hallucinated is dropped.
    const validIds = new Set(ctx.list.map((t) => String(t._id)));
    const labelById = new Map(ctx.list.map((t) => [String(t._id), t.TaskKey || t.TaskName || 'this task']));
    const seenIds = new Set();
    const plan = [];
    for (const a of parsed.actions) {
        if (plan.length >= MAX_ACTIONS) break;
        const actionKey = a && String(a.action || '').trim();
        const taskId = a && String(a.taskId || '').trim();
        const message = a && String(a.message || '').trim();
        if (!LLM_ALLOWED_ACTIONS.has(actionKey)) continue;
        if (!validIds.has(taskId)) continue;
        if (!message) continue;
        if (seenIds.has(taskId)) continue;
        seenIds.add(taskId);
        plan.push({
            actionKey,
            taskId,
            params: { text: message },
            reason: (a.reason && String(a.reason).trim()) || `AI review flagged ${labelById.get(taskId)}.`,
        });
    }

    return {
        summary: (parsed.summary && String(parsed.summary).trim()) || '',
        model: result.model || '',
        tokens: result.totalTokens || 0,
        truncated: !!result.truncated,
        plan,
    };
}

module.exports = { reviewProject };
