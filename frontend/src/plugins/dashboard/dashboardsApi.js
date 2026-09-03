import { apiRequest } from '@/services';
import * as env from '@/config/env';

const body = (res) => (res && res.data) || {};
const payload = (res) => body(res).data;

export const fetchDashboards = () => apiRequest('get', env.DASHBOARDS).then((r) => payload(r) || []);

export const fetchDashboard = (id) => apiRequest('get', `${env.DASHBOARDS}/${id}`).then(payload);

export const createDashboard = (data) => apiRequest('post', env.DASHBOARDS, data).then(payload);

export const patchDashboard = (id, data) => apiRequest('put', `${env.DASHBOARDS}/${id}`, data).then(payload);

export const saveDashboardCards = (id, cards) => apiRequest('put', `${env.DASHBOARDS}/${id}/cards`, { cards }).then(payload);

export const duplicateDashboard = (id) => apiRequest('post', `${env.DASHBOARDS}/${id}/duplicate`, {}).then(payload);

export const removeDashboard = (id) => apiRequest('delete', `${env.DASHBOARDS}/${id}`).then(payload);

export const makeCardUid = () => Math.floor(100000000 + Math.random() * 900000000).toString();
