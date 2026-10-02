import { apiRequest } from '@/services';
import * as env from '@/config/env';

const duplicateUrl = (projectId) => `${env.PROJECTS_V2}/${projectId}/duplicate`;

/* A refusal answers its reason as an HTTP error, or as status false on a 200. */
const reasonOf = (error) => error?.response?.data?.statusText || '';

export async function duplicateProject(projectId, { name, include }) {
    try {
        const { data: answer } = await apiRequest('post', duplicateUrl(projectId), { name, include });
        if (!answer?.status || !answer.data?.project) return { ok: false, message: answer?.statusText || '' };
        return { ok: true, ...answer.data };
    } catch (error) {
        return { ok: false, message: reasonOf(error) };
    }
}

export const linkedTo = (field, projectId) => field.global !== true && [].concat(field.projectId || []).map(String).includes(String(projectId));

/* The server links a new project to these definitions and tells no client; a list that lacked the project would take the field off it on the next edit. */
export function shareFields(store, fieldIds, projectId) {
    const known = store.getters['settings/finalCustomFields'] || [];
    (fieldIds || []).forEach((id) => {
        const field = known.find((item) => String(item._id) === String(id));
        if (field && !linkedTo(field, projectId)) {
            store.commit('settings/mutateFinalCustomFields', { op: 'modified', data: { ...field, projectId: [...[].concat(field.projectId || []), projectId] } });
        }
    });
}

/* The tasks of a large copy arrive after the answer; `copyId` is the new project. Null when a read fails, so the caller asks again. */
export async function duplicateProgress(copyId) {
    try {
        const { data: answer } = await apiRequest('get', duplicateUrl(copyId));
        return answer?.status ? answer.data : null;
    } catch {
        return null;
    }
}
