const api = require('./api');
const { eventsOfPull } = require('./keys');
const actions = require('../taskActions');
const repoMap = require('./repoMap');

/* The cursor moves to the newest pull request read, or stays at `since` when the list was cut, so nothing older is skipped;
 * GitHub timestamps have a second's resolution, so the newest comes back once more and its claims turn it away. */
async function poll({ companyId, config, repo, since, get }) {
    if (!config.token) throw new Error('No GitHub token is stored; connect GitHub again.');
    if (!repo) throw new Error('No repository is picked yet; pick one on App connections.');
    if (!repoMap.isRepo(repo)) throw new Error('The repository must look like owner/repo.');
    const { pulls, truncated } = await api.listPulls({ repo, token: config.token, companyId, since, get });
    const events = pulls.flatMap((pull) => eventsOfPull(repo, pull));
    const seen = pulls.map((pull) => pull.updated_at);
    const cursor = seen.length && !truncated ? seen[seen.length - 1] : since || null;
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
        if (!await ctx.claim(`${event.key}:${task._id}`, task._id)) continue;
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

const waiting = () => 'No repository is picked yet.';

module.exports = { type: 'github', poll, handle, waiting, targets: repoMap.reposOf };
