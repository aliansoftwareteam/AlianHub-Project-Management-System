'use strict';

const { FEATURES } = require('../AICore/features');
const { taskContext, clip } = require('./taskContext');
const { askJson, failure } = require('./assistCall');

const MAX_RESULTS = 6;

const SYSTEM = [
    'You research one project-management task from web search results.',
    'Use only the numbered RESULTS given; cite each claim inline as [n] with the result number.',
    'Write 3 to 6 short sentences a teammate can act on. If the results do not help, say so plainly.',
    'Return a single JSON object: {"summary": "<text>"}.',
].join(' ');

const externalReadsOn = () => ['on', 'true', '1', 'yes'].includes(String(process.env.SKILL_EXTERNAL_READS || 'off').trim().toLowerCase());

/* No web-search tool ships with AlianHub yet. Research stays hidden until one is returned here,
 * and even then only while the instance lets AI read outside the workspace. */
const searchTool = () => null;

function capability() {
    if (!externalReadsOn()) return { available: false, reason: 'egress_off' };
    const search = searchTool();
    return search ? { available: true, search } : { available: false, reason: 'no_web_search_tool' };
}

const isWebUrl = (url) => {
    try { return ['http:', 'https:'].includes(new URL(String(url)).protocol); } catch (e) { return false; }
};

/* Only the task's own name and description leave the workspace as the search query: never its
 * comments, subtasks or docs. */
async function researchTask({ companyId, uid, taskId, search }) {
    if (typeof search !== 'function') return { status: false, notAvailable: true, code: 'research_not_available', reason: 'Research is not available on this instance.' };
    const ctx = await taskContext({ companyId, uid, taskId });
    if (!ctx) return { status: false, notFound: true, code: 'task_not_found', reason: 'Task not found.' };
    const query = clip(`${ctx.task.TaskName} ${clip(ctx.task.rawDescription, 200)}`, 300);
    const found = ((await search(query)) || []).filter((r) => r && isWebUrl(r.url)).slice(0, MAX_RESULTS);
    if (!found.length) return { status: false, code: 'no_results', reason: 'The search found nothing for this task.' };
    const sources = found.map((r, i) => ({ n: i + 1, title: clip(r.title, 200) || r.url, url: String(r.url) }));
    const outcome = await askJson({
        system: SYSTEM,
        data: [`Task: ${clip(ctx.task.TaskName, 300)}`, 'RESULTS:', ...found.map((r, i) => `[${i + 1}] ${clip(r.title, 200)} (${r.url}): ${clip(r.snippet, 600)}`)].join('\n'),
        maxTokens: 700,
        spend: { feature: FEATURES.TASK_ASSIST, companyId, userId: uid },
    });
    if (!outcome.ok) return failure(outcome);
    const summary = String(outcome.value.summary || '').trim();
    if (!summary) return { status: false, code: 'bad_answer', reason: 'The model returned no summary.' };
    return { status: true, data: { summary, sources } };
}

module.exports = { capability, researchTask };
