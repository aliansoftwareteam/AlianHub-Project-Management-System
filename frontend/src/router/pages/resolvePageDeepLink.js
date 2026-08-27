import { apiRequest } from '@/services';
import { firstId, pageDeepLinkNeedsResolve, pageFromGetResponse, pageOpenRoute, pageProjectId } from '@/utils/taskOpenProjectId';

const RESOLVE_MS = 5000;

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
        && firstId(to.query && to.query.page) === firstId(dest.query && dest.query.page)
        && String((to.query && to.query.unresolved) || '') === String((dest.query && dest.query.unresolved) || '');
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        Promise.resolve(promise).then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}

export async function resolvePageDeepLink(to) {
    const pageId = firstId(to && to.query && to.query.page);
    const cid = firstId(to && to.params && to.params.cid);
    const knownPid = queryProjectId(to);
    if (!cid || to.name !== 'Pages' || !pageId) return null;
    if (String((to.query && to.query.unresolved) || '') === '1') return null;

    if (knownPid) {
        const dest = pageOpenRoute({ companyId: cid, projectId: knownPid, pageId });
        return dest && !sameDest(to, dest) ? dest : null;
    }

    if (!pageDeepLinkNeedsResolve({ pageId, projectId: knownPid, routeName: to.name })) return null;

    try {
        if (typeof localStorage !== 'undefined' && !localStorage.getItem('selectedCompany')) {
            localStorage.setItem('selectedCompany', cid);
        }
        const response = await withTimeout(
            apiRequest('get', `/api/v2/pages/${pageId}`, null, null, { headers: { companyId: cid } }),
            RESOLVE_MS,
        );
        const page = pageFromGetResponse(response);
        const dest = pageOpenRoute({ companyId: cid, projectId: pageProjectId(page), pageId });
        if (dest) return dest;
    } catch (error) {
        console.error('ERROR resolving page deep link: ', error);
    }

    return {
        name: 'Pages',
        params: { cid },
        query: { page: pageId, unresolved: '1' },
    };
}
