const api = require('./api');
const { eventsOfPull } = require('./keys');
const actions = require('../taskActions');

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/* `since` is where the last poll got to; GitHub timestamps have a second's resolution, so the pull request that
 * sets the cursor comes back once more and the ledger drops the event it already acted on. */
async function poll({ companyId, config, since, get }) {
    if (!config.token) throw new Error('No GitHub token is stored; connect GitHub again.');
    if (!REPO.test(String(config.repo || ''))) throw new Error('The repository must look like owner/repo.');
    const { pulls, truncated } = await api.listPulls({ repo: config.repo, token: config.token, companyId, since, get });
    const events = pulls.flatMap((pull) => eventsOfPull(config.repo, pull));
    const seen = pulls.map((pull) => pull.updated_at);
    const cursor = seen.length ? (truncated ? seen[0] : seen[seen.length - 1]) : since || null;
    return { events, cursor, truncated };
}

const sha = (value) => String(value || '').slice(0, 7);

const openedText = (d) => `Pull request #${d.number} "${d.title.slice(0, 200)}" was opened${d.author ? ` by ${d.author}` : ''}: ${d.url}`;
const mergedText = (d) => `Pull request #${d.number} was merged${d.mergeCommit ? ` in commit ${sha(d.mergeCommit)}` : ''}: ${d.url}`;

/* One claim per event and task, taken before anything is written, so a repeated poll or a second server cannot act twice. */
async function handle(ctx, event) {
    const d = event.data;
    if (!d.keys.length) return [];
    const tasks = await actions.findTasks(ctx.companyId, ctx.projectIds, d.keys);
    const done = [];
    for (const task of tasks) {
        if (!await ctx.claim(`${event.key}:${task._id}`)) continue;
        if (event.kind === 'opened') {
            const link = await actions.addLink(ctx.companyId, task, { url: d.url, label: `PR #${d.number} ${d.title}` }, ctx.actingUserId);
            await actions.addComment(ctx.companyId, task, openedText(d), ctx.actingUserId);
            done.push({ action: 'app_connection.task_linked', task, meta: { pr: d.number, repo: d.repo, linked: link.added } });
        } else if (event.kind === 'merged') {
            await actions.addComment(ctx.companyId, task, mergedText(d), ctx.actingUserId);
            const move = await actions.moveToReview(ctx.companyId, task);
            done.push({ action: 'app_connection.task_moved', task, meta: { pr: d.number, repo: d.repo, commit: sha(d.mergeCommit), moved: move.moved, ...(move.reason ? { reason: move.reason } : {}) } });
        }
    }
    return done;
}

module.exports = { type: 'github', poll, handle };
