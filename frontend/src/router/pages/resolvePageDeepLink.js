import { firstId, pageOpenRoute } from '@/utils/taskOpenProjectId';

function queryProjectId(route) {
    return firstId(
        route && route.params && route.params.projectId,
        route && route.query && (route.query.project || route.query.projectId),
    );
}

function sameDest(to, dest) {
    if (!to || !dest) return false;
    return to.name === dest.name
        && firstId(to.params && to.params.cid) === firstId(dest.params && dest.params.cid)
        && firstId(to.params && to.params.projectId) === firstId(dest.params && dest.params.projectId)
        && firstId(to.query && to.query.page) === firstId(dest.query && dest.query.page);
}

export async function resolvePageDeepLink(to) {
    const pageId = firstId(to && to.query && to.query.page);
    const cid = firstId(to && to.params && to.params.cid);
    const knownPid = queryProjectId(to);
    if (!cid || to.name !== 'Pages' || !pageId) return null;

    if (knownPid) {
        const dest = pageOpenRoute({ companyId: cid, projectId: knownPid, pageId });
        return dest && !sameDest(to, dest) ? dest : null;
    }

    return null;
}
