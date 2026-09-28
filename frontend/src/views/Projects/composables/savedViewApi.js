import { apiRequest } from '@/services';
import * as env from '@/config/env';

const bodyOf = (response) => {
    const body = response?.data;
    if (!body || body.status === false) throw new Error(body?.statusText || 'Request failed');
    return body;
};

export const saveSharedViewSettings = (projectId, viewId, settings) => apiRequest('put', `/api/v1/${env.PROJECTACTIONS}/${projectId}/view-settings`, { viewId, settings }).then(bodyOf);

export const createSharedView = (projectId, { sourceViewId, title, settings }) => apiRequest('post', `/api/v1/${env.PROJECTACTIONS}/${projectId}/views`, { sourceViewId, title, settings }).then(bodyOf);

export const savePrivateViewSettings = (memberRowId, viewId, settings) => apiRequest('post', `${env.API_MEMBERS}/private-view`, { id: memberRowId, operation: 'settings', data: { id: viewId, settings } }).then(bodyOf);

export const createPrivateView = (memberRowId, view) => apiRequest('post', `${env.API_MEMBERS}/private-view`, { id: memberRowId, operation: 'push', data: view }).then(bodyOf);
