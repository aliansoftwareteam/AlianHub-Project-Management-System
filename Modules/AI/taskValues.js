const logger = require('../../Config/loggerConfig');
const values = require('./taskAiValues');
const { visibleTasks } = require('./taskAccess');
const summaries = require('./taskSummary');
const categories = require('./taskCategory');

const MAX_TASKS = 200;

const refuse = (res, statusCode, statusText) => res.status(statusCode).send({ status: false, statusText });

/* POST /api/v1/ai/task-values  body: { taskIds, kinds?: ['summary' | 'category'] }
 * The kept summary and area of the rows a table shows, each marked `stale` when its task or thread has changed
 * since. A task the caller cannot open is left out exactly as one with nothing kept is. Never calls the model. */
const keptValues = async (req, res) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const uid = req.uid ? String(req.uid) : '';
        if (!companyId || !uid) return refuse(res, 401, 'companyId and an authenticated user are required.');
        const body = req.body || {};
        const asked = Array.isArray(body.taskIds) ? body.taskIds : [];
        if (asked.length > MAX_TASKS) return refuse(res, 400, `At most ${MAX_TASKS} tasks can be read at once.`);
        const kinds = (Array.isArray(body.kinds) ? body.kinds : values.KINDS).filter((kind) => values.KINDS.includes(kind));

        const tasks = await visibleTasks({ companyId, uid, taskIds: asked, projection: { TaskName: 1, rawDescription: 1, description: 1 } });
        const taskById = new Map(tasks.map((task) => [String(task._id), task]));
        const rows = await values.keptMany(companyId, [...taskById.keys()], kinds);

        const counts = await summaries.commentCounts(companyId, rows.filter((row) => row.kind === values.SUMMARY).map((row) => row.taskId));
        const vocabularies = new Map();
        const out = {};
        for (const row of rows) {
            const view = row.kind === values.SUMMARY
                ? summaries.keptView(row, counts[row.taskId] || 0)
                : categories.keptView(row, await categories.basisOf(companyId, taskById.get(row.taskId), vocabularies));
            const { cached, configured, ...shown } = view;
            out[row.taskId] = { ...(out[row.taskId] || {}), [row.kind]: shown };
        }
        return res.send({ status: true, statusText: 'OK', data: { values: out } });
    } catch (error) {
        logger.error(`ai task values: ${error.message}`);
        return refuse(res, 500, error.message);
    }
};

module.exports = { keptValues, MAX_TASKS };
