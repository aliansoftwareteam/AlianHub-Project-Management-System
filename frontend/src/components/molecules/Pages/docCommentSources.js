import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { initials } from './docsFormat';
import { taskMentionItem } from './docMentions';

const TASK_LIMIT = 8;
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* What the mention picker offers inside a doc comment. `people` returns the people who can read the doc, so nobody
 * else is ever offered; docs and tasks come from the lists the reader can already open. */
export function docCommentSources({ pageId, people, untitled }) {
    let docIndex = null;

    return {
        people(query) {
            const wanted = query.trim().toLowerCase();
            return people()
                .filter((person) => !wanted || person.name.toLowerCase().includes(wanted))
                .map((person) => ({ type: 'user', id: person.id, label: person.name, image: person.image, initials: initials(person.name) }));
        },
        async docs(query) {
            if (!docIndex) {
                docIndex = apiRequest('get', `${env.PAGES}?scope=all`)
                    .then((response) => (response.data && response.data.status && Array.isArray(response.data.data) ? response.data.data : []))
                    .catch(() => { docIndex = null; return []; });
            }
            const wanted = query.trim().toLowerCase();
            return (await docIndex)
                .filter((page) => String(page._id) !== String(pageId()) && (!wanted || String(page.title || '').toLowerCase().includes(wanted)))
                .map((page) => ({ type: 'doc', id: String(page._id), label: page.title || untitled() }));
        },
        tasks(query) {
            const escaped = escapeRegex(query.trim());
            return apiRequest('post', `${env.TASK}/find`, {
                findQuery: [
                    { $match: {
                        deletedStatusKey: { $in: [0, undefined] },
                        $or: [{ TaskName: { $regex: escaped, $options: 'i' } }, { TaskKey: { $regex: escaped, $options: 'i' } }],
                    } },
                    { $project: { TaskName: 1, TaskKey: 1 } },
                    { $sort: { updatedAt: -1 } },
                    { $limit: TASK_LIMIT },
                ],
            }).then((response) => (Array.isArray(response.data) ? response.data : []).map(taskMentionItem));
        },
    };
}
