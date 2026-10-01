const tools = require('../Automations/engine/tools');

// Doc changes an agent makes the way a person makes them: through the page routes' own handlers,
// as the person behind the agent, so access, mentions, the change feed and the version history
// are the web app's. The handlers are loaded on first use.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TITLE_MAX = 200;
const TEXT_MAX = 100000;

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));

const personOf = (actor) => {
    const uid = idOf(actor && actor.userId);
    if (!OBJECT_ID.test(uid)) throw refuse('a doc change needs a person to make it as');
    return uid;
};

/* What a route handler answers when it is called as `uid` with no HTTP around it. */
const answerOf = (handler, { companyId, uid, params = {}, body = {} }) => new Promise((resolve, reject) => {
    const res = { status: () => res, send: (sent) => { resolve(sent); return res; }, json: (sent) => { resolve(sent); return res; } };
    const req = { uid, aud: String(companyId), headers: { companyid: String(companyId) }, params, query: {}, body };
    Promise.resolve(handler(req, res)).catch(reject);
});

const dataOf = async (handler, request) => {
    const answer = await answerOf(handler, request);
    if (!answer || answer.status !== true) throw refuse((answer && answer.statusText) || 'the doc was not saved');
    return answer.data || {};
};

const blocksOf = (text) => {
    if (typeof text !== 'string' || text.length > TEXT_MAX) throw refuse(`text needs at most ${TEXT_MAX} characters`);
    return require('../Pages/helpers/pageContent').markdownToBlocks(text);
};

/* The editor sends a body both ways; with the blocks alone the save would keep the html it already had. */
const bodyOf = (text) => {
    const { contentToEditorData, blocksToHtml } = require('../Pages/helpers/pageContent');
    const contentBlocks = blocksOf(text);
    return { contentBlocks, contentHtml: blocksToHtml(contentToEditorData({ blocks: contentBlocks })) };
};

const titleOf = (title) => {
    const clean = typeof title === 'string' ? title.trim() : '';
    if (!clean || clean.length > TITLE_MAX) throw refuse(`title needs 1 to ${TITLE_MAX} characters`);
    return clean;
};

const restoreVersion = async ({ companyId, uid, pageId, versionId }) => dataOf(require('../Pages/versions').restoreVersion, { companyId, uid, params: { id: idOf(pageId), versionId: idOf(versionId) } });

const executors = {
    async 'page.create'({ companyId, actor, params }) {
        const uid = personOf(actor);
        const created = await dataOf(require('../Pages/controller').createPage, { companyId, uid, body: {
            title: titleOf(params.title),
            ...(params.projectId ? { projectId: idOf(params.projectId) } : {}),
            ...(params.parentPageId ? { parentPageId: idOf(params.parentPageId) } : {}),
            ...(params.taskId ? { linkedTasks: [idOf(params.taskId)] } : {}),
            ...(params.text !== undefined ? { contentBlocks: blocksOf(params.text) } : {}),
            createdByAgent: true,
            agentName: String(actor.agentName || 'Agent'),
        } });
        const pageId = idOf(created._id);
        return { result: { pageId, title: created.title || '', draft: true }, undo: { kind: 'page', pageId }, entityType: 'page', entityId: pageId, entityName: created.title || '' };
    },

    async 'page.update'({ companyId, actor, params }) {
        const uid = personOf(actor);
        const pageId = idOf(params.pageId);
        if (!OBJECT_ID.test(pageId)) throw refuse('page not found');
        const body = {
            ...(params.title !== undefined ? { title: titleOf(params.title) } : {}),
            ...(params.text !== undefined ? bodyOf(params.text) : {}),
        };
        if (!Object.keys(body).length) throw refuse('name a title or a text to change');
        // The state about to be replaced is kept as a version first, so this change can always be put back.
        const kept = await answerOf(require('../Pages/versions').saveVersion, { companyId, uid, params: { id: pageId }, body: {} });
        const versionId = kept && kept.status === true && kept.data ? idOf(kept.data._id) : '';
        const updated = await dataOf(require('../Pages/controller').updatePage, { companyId, uid, params: { id: pageId }, body });
        return {
            result: { pageId, title: updated.title || '' },
            undo: versionId ? { kind: 'pageVersion', pageId, versionId, projectId: idOf(updated.ProjectID) } : null,
            entityType: 'page', entityId: pageId, entityName: updated.title || '',
        };
    },
};

module.exports = { executors, answerOf, restoreVersion, TITLE_MAX, TEXT_MAX };
