import { apiRequest } from '@/services';
import {
    firstId,
    pageFromGetResponse,
    pageOpenRoute,
    pageProjectId,
} from '@/utils/taskOpenProjectId';

const RESOLVE_MS = 8000;

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

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        Promise.resolve(promise).then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}

async function fetchPageRow(pageId, cid) {
    const headers = { headers: { companyId: cid } };
    const response = await apiRequest('get', `/api/v2/pages/${pageId}`, null, null, headers);
    const page = pageFromGetResponse(response);
    if (page && pageProjectId(page)) return page;
    const listed = await apiRequest('get', '/api/v2/pages?scope=all', null, null, headers);
    const rows = listed && listed.data && listed.data.status ? (listed.data.data || []) : [];
    return rows.find((row) => firstId(row && (row._id || row.id)) === pageId) || page || null;
}

export async function resolvePageDeepLink(to) {
    const pageId = firstId(to && to.query && to.query.page);
    const cid = firstId(to && to.params && to.params.cid);
    const knownPid = queryProjectId(to);
    if (!cid || !pageId) return null;
    const path = String((to && to.path) || '');
    const onPages = to.name === 'Pages'
        || to.name === 'ProjectPages'
        || /\/pages\/?$/.test(path);
    if (!onPages) return null;

    if (knownPid) {
        const dest = pageOpenRoute({ companyId: cid, projectId: knownPid, pageId });
        return dest && !sameDest(to, dest) ? dest : null;
    }

    try {
        if (typeof localStorage !== 'undefined' && !localStorage.getItem('selectedCompany')) {
            localStorage.setItem('selectedCompany', cid);
        }
        const page = await withTimeout(fetchPageRow(pageId, cid), RESOLVE_MS);
        const dest = pageOpenRoute({ companyId: cid, projectId: pageProjectId(page), pageId });
        if (dest) return dest;
    } catch (error) {
        console.error('ERROR resolving page deep link: ', error);
    }

    return null;
}
