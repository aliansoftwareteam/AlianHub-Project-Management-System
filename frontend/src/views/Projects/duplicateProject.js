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

/* The tasks of a large copy arrive after the answer; `copyId` is the new project. Null when a read fails, so the caller asks again. */
export async function duplicateProgress(copyId) {
    try {
        const { data: answer } = await apiRequest('get', duplicateUrl(copyId));
        return answer?.status ? answer.data : null;
    } catch {
        return null;
    }
}
