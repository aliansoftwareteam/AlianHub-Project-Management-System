import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

export const PROJECT_TEMPLATES_EVENT = 'projectTemplatesChanged';
export const NAME_LIMIT = 255;
export const DESCRIPTION_LIMIT = 2000;

const templatesUrl = `${env.PROJECTS_V2}/templates`;

/* A refusal answers its reason as an HTTP error, or as status false on a 200. */
const reasonOf = (error) => error?.response?.data?.statusText || '';

async function answered(request) {
    try {
        const { data: answer } = await request();
        return answer?.status ? { ok: true, data: answer.data } : { ok: false, message: answer?.statusText || '' };
    } catch (error) {
        return { ok: false, message: reasonOf(error) };
    }
}

export async function saveProjectTemplate(projectId, { name, description, everyone, include }) {
    const answer = await answered(() => apiRequest('post', `${env.PROJECTS_V2}/${projectId}/template`, { name, description, everyone, include }));
    return answer.ok && answer.data?.template ? { ok: true, ...answer.data } : { ok: false, message: answer.message || '' };
}

export const editProjectTemplate = (templateId, changes) => answered(() => apiRequest('patch', `${templatesUrl}/${templateId}`, changes));

export const deleteProjectTemplate = (templateId) => answered(() => apiRequest('delete', `${templatesUrl}/${templateId}`));

export async function createFromTemplate(templateId, body) {
    const answer = await answered(() => apiRequest('post', `${templatesUrl}/${templateId}/use`, body));
    return answer.ok && answer.data?.project ? { ok: true, ...answer.data } : { ok: false, message: answer.message || '' };
}

const TEAM_PREFIX = 'tId_';
const listsOf = (project) => [
    ...Object.values(project?.sprintsObj || {}),
    ...Object.values(project?.sprintsfolders || {}).flatMap((folder) => Object.values(folder?.sprintsObj || {})),
];

/* Whether the project has a live private list this person is on. A list shared with a team counts: which teams a person is in
   is the server's to say, and guessing yes only keeps the template with them until they choose otherwise. */
export const isOnPrivateList = (project, userId) => listsOf(project).some((list) => list?.private === true
    && !Number(list.deletedStatusKey || 0)
    && (list.AssigneeUserId || []).map(String).some((id) => id === String(userId) || id.startsWith(TEAM_PREFIX)));

export const countsText =(counts, t) => ['folders', 'lists', 'tasks']
    .map((kind) => t(`Projects.template_${kind}`, { n: Number(counts?.[kind]) || 0 }, Number(counts?.[kind]) || 0))
    .join(', ');

/* The templates this person is offered, read again whenever the workspace says they changed. Someone who may not create a
   project is refused the list; they are shown none. */
export function useProjectTemplates() {
    const socket = inject('$socket', ref(null));
    const templates = ref([]);
    let bound = null;

    const load = async () => {
        const answer = await answered(() => apiRequest('get', templatesUrl));
        templates.value = answer.ok && Array.isArray(answer.data) ? answer.data : [];
    };

    function unbind() {
        bound?.off?.(PROJECT_TEMPLATES_EVENT, load);
        bound = null;
    }

    function bind() {
        const live = socket?.value;
        if (live === bound) return;
        unbind();
        if (!live?.on) return;
        bound = live;
        live.on(PROJECT_TEMPLATES_EVENT, load);
    }

    onMounted(() => {
        load();
        bind();
    });
    watch(() => socket?.value, bind);
    onBeforeUnmount(unbind);

    return { templates, load };
}
