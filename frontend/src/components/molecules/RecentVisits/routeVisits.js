import { apiRequest } from '@/services';
import * as env from '@/config/env';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PROJECT_ROUTES = new Set(['Project', 'ProjectFolder', 'ProjectFolderSprint', 'ProjectFolderSprintTask', 'ProjectSprint', 'ProjectSprintTask']);

/* Tasks are recorded by the task detail itself, since most open in the side panel without a route of their own. */
export function visitsForRoute(route) {
    if (!route || !route.meta || !route.meta.requiresAuth) return [];
    const params = route.params || {};
    const visits = [];
    const add = (entityType, id) => {
        if (OBJECT_ID.test(String(id || ''))) visits.push({ entityType, entityId: String(id) });
    };
    if (PROJECT_ROUTES.has(route.name)) {
        add('project', params.id);
        add('sprint', params.sprintId);
    } else if (route.name === 'PageEditor') {
        add('doc', params.pageId);
    }
    return visits;
}

/* A visit is sent when the person arrives, not again for every tab or query change while they stay. */
export function createVisitRecorder(send) {
    let current = new Set();
    return (route) => {
        const visits = visitsForRoute(route);
        const keys = new Set(visits.map((visit) => `${visit.entityType}:${visit.entityId}`));
        visits.filter((visit) => !current.has(`${visit.entityType}:${visit.entityId}`)).forEach((visit) => send(visit));
        current = keys;
    };
}

export const recordRouteVisit = createVisitRecorder((visit) => {
    apiRequest('post', env.RECENT_VISITS, visit).catch(() => {});
});
