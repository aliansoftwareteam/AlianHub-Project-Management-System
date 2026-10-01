import { ref } from 'vue';
import * as env from '@/config/env';
import { apiRequest } from '@/services';
import { useCustomComposable } from '@/composable';
import { scopeOf } from '@fieldTypes/relationship';

const SHOWN = 10;
const WAIT_MS = 300;

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* The task query answers only tasks this person can open, so a search offers nothing the server would refuse to link. */
function findQuery(text, definition, limit) {
    const { scope, projectId, sprintId } = scopeOf(definition);
    return [
        {
            $match: {
                ...(scope === 'any' ? {} : { ProjectID: { objId: { $in: [projectId] } } }),
                ...(scope === 'list' ? { sprintId: { objId: { $in: [sprintId] } } } : {}),
                deletedStatusKey: { $in: [0, undefined] },
                mainChat: { $ne: true },
                $or: [{ TaskName: { $regex: escaped(text), $options: 'i' } }, { TaskKey: { $regex: escaped(text), $options: 'i' } }]
            }
        },
        { $project: { TaskName: 1, TaskKey: 1, ProjectID: 1, sprintId: 1, folderObjId: 1 } },
        { $limit: limit }
    ];
}

export const taskLink = (row) => ({
    id: String(row._id), key: row.TaskKey || '', title: row.TaskName || '',
    projectId: String(row.ProjectID || ''), sprintId: String(row.sprintId || ''), folderId: String(row.folderObjId || '')
});

/* A task search within what a relationship field may link. `definition` and `held` (ids to leave out) are read on each search. */
export function useTaskSearch({ definition, held = () => [] }) {
    const { debounce } = useCustomComposable();
    const query = ref('');
    const results = ref([]);
    const searching = ref(false);

    async function search() {
        const text = query.value.trim();
        if (!text) {
            results.value = [];
            return;
        }
        searching.value = true;
        try {
            const leftOut = held().map(String);
            const response = await apiRequest('post', `${env.TASK}/find`, { findQuery: findQuery(text, definition(), SHOWN + leftOut.length) });
            results.value = (response?.data || []).filter((row) => row?._id && !leftOut.includes(String(row._id))).slice(0, SHOWN).map(taskLink);
        } catch (error) {
            console.error('ERROR in searching tasks to link: ', error);
            results.value = [];
        } finally {
            searching.value = false;
        }
    }

    function clear() {
        query.value = '';
        results.value = [];
    }

    return { query, results, searching, onSearch: debounce(() => search(), WAIT_MS), clear };
}
