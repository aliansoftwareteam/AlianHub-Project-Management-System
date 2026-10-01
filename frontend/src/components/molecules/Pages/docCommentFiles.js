import { apiRequest, apiRequestWithoutCompnay } from '@/services';
import * as env from '@/config/env';
import { generateFileName, storageQueryBuilder } from '@/utils/storageQueryBuild';

/* A doc comment's file lives in its doc's own comment folder; the server refuses a comment that names any other key. */
export async function uploadDocCommentFile({ companyId, pageId, file }) {
    const form = new FormData();
    form.append('companyId', companyId);
    form.append('path', `Pages/${pageId}/Comments/${generateFileName(file.name, env.STORAGE_TYPE)}`);
    form.append('file', file);
    const response = await apiRequestWithoutCompnay('post', storageQueryBuilder('upload').route, form, 'form');
    const body = response && response.data;
    if (!body || !body.status || !body.statusText) throw new Error((body && body.statusText) || 'upload');
    return { mediaURL: body.statusText, mediaOriginalName: file.name, mediaSize: file.size };
}

export function removeDocCommentFile(companyId, key) {
    const request = storageQueryBuilder('delete', companyId, key);
    return apiRequest(request.method, request.route, request.data);
}
