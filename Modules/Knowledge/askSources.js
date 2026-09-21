const { retrieve } = require('./retrieval');

/* Ask's source list, gathered through the retrieval interface. A project the caller
 * cannot open is ignored rather than refused, as Ask has always done with it. */
const askSources = async ({ companyId, uid, question, projectId, projects, limit }) => {
    const nameById = {};
    (projects || []).forEach((p) => { nameById[String(p._id)] = p.ProjectName || ''; });
    const scope = projectId && nameById[String(projectId)] !== undefined ? { projectId: String(projectId) } : {};

    const { passages } = await retrieve({ companyId, caller: { kind: 'user', userId: uid }, query: question, scope, limit });
    return passages.map((p) => ({
        kind: p.sourceType,
        id: p.sourceId,
        ref: `${p.sourceType}:${p.sourceId.slice(-6)}`,
        title: p.title,
        project: nameById[p.projectId] || '',
        projectId: p.projectId,
        detail: p.excerpt,
        updatedAt: p.updatedAt,
        permission: p.permission,
        origin: p.origin,
        ...(p.taskId ? { taskId: p.taskId } : {}),
    }));
};

module.exports = { askSources };
