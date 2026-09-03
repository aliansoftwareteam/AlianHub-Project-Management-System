const orchestrator = require('../../../Agents/engine/orchestrator');
const { createSubtask, addComment } = require('../tools');
const memory = require('../../../Agents/engine/findingMemory');

// The bridge between the two engines.
//
// ADR 002's central decision: the agent is NOT a separate system with its own
// triggers, permissions and audit trail. It is one more automation action, so a
// rule can read "when status changes to Done, run the QA agent, then do something
// with the verdict" using the same builder, run log and audit rows as every other
// action. That is what stops two engines becoming two products.

module.exports = {
    key: 'run_agent',
    label: 'Run an AI agent',
    appliesTo: ['task'],
    scopes: ['task.read', 'task.subtask.create', 'task.comment'],
    schema: {
        skill: { type: 'select', label: 'Skill', required: true, options: ['qa-review'] },
        fileSubtasks: { type: 'boolean', label: 'File each finding as a subtask', required: false },
        postSummary: { type: 'boolean', label: 'Post a summary comment', required: false },
    },
    async run({ companyId, entity, config, context }) {
        const task = context.task || {};
        const result = await orchestrator.run({ skillSlug: config.skill || 'qa-review', task });

        if (result.status !== 'success') {
            // A skipped run is a legitimate outcome, not a failure: most tasks have
            // no URL to review, and failing the whole rule for that would make the
            // automation unusable on a normal board.
            if (result.status === 'skipped') return { changed: false, verdict: 'skipped', reason: result.reason };
            const err = new Error(result.reason || 'agent run failed');
            err.deterministic = true;
            throw err;
        }

        const created = [];
        const skipped = [];
        const refiled = [];
        if (config.fileSubtasks !== false) {
            // Consult memory before writing anything. Without this a second run on
            // the same task files every finding again — measured: 6 findings became
            // 12 subtasks, and only 2 were string-identical, so the titles cannot
            // be used to spot the repeats.
            const known = await memory.load(companyId, entity.id);
            const decisions = await memory.decide(companyId, entity.id, result.findings, known);

            for (const d of decisions) {
                const f = d.finding;
                if (d.action === 'skip') {
                    skipped.push({ factId: f.factId, reason: d.reason });
                    // eslint-disable-next-line no-await-in-loop
                    await memory.touch(companyId, d.prior);
                    continue;
                }
                const body = [
                    f.why,
                    f.fix ? `\nFix: ${f.fix}` : '',
                    f.evidence ? `\nEvidence: ${f.evidence}` : '',
                    d.action === 'refile' ? `\nRegression: this was filed before and closed, and the defect is present again.` : '',
                    `\n— filed by the ${result.skill} agent from ${result.url}`,
                ].filter(Boolean).join('');
                // eslint-disable-next-line no-await-in-loop
                const sub = await createSubtask(companyId, entity.id, { title: `[${f.severity}] ${f.title}`, description: body }, context);
                created.push(sub.subtaskId);
                if (d.action === 'refile') refiled.push(f.factId);
                // eslint-disable-next-line no-await-in-loop
                await memory.record(companyId, {
                    projectId: task.ProjectID, taskId: entity.id, factId: f.factId, skill: result.skill,
                    subtaskId: sub.subtaskId, title: f.title, severity: f.severity, prior: d.prior,
                });
            }
        }

        if (config.postSummary !== false) {
            const lines = [
                `QA Review — ${result.url}`,
                result.summary,
                ``,
                `${result.checksPassed}/${result.checksRun} checks passed.`,
                `${created.length} subtask(s) filed${refiled.length ? `, ${refiled.length} of them regressions` : ''}.`,
                skipped.length ? `${skipped.length} already tracked or marked wontfix — not filed again.` : '',
                result.degraded ? `Note: ran without the model (${result.degraded}).` : '',
                result.dropped?.length ? `${result.dropped.length} proposed finding(s) rejected by the evidence gate.` : '',
                ``,
                `Not checked (needs a browser): ${result.blindSpots.join('; ')}.`,
            ].filter(Boolean).join('\n');
            await addComment(companyId, entity.id, lines, context);
        }

        return {
            changed: created.length > 0,
            verdict: result.findings.length ? 'issues_found' : 'clean',
            skipped: skipped.length,
            refiled: refiled.length,
            url: result.url,
            findings: result.findings.length,
            subtasks: created,
            checksRun: result.checksRun,
            degraded: result.degraded || null,
            tokens: result.usage?.totalTokens || 0,
        };
    },
};
