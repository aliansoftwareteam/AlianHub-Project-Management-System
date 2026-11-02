import { computed, reactive } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from '@/composable';

/* Shared by every Time tab in this session, so switching tabs does not reload the projects. */
const state = reactive({ companyId: '', projects: [], loading: null, sprintsByProject: {} });

const byLabel = (a, b) => String(a.label).localeCompare(String(b.label));
const uniqueBy = (list, keyOf) => [...new Map(list.map((item) => [keyOf(item), item])).values()];
const colorOf = (project) => (project && project.projectIcon && project.projectIcon.type === 'color' ? project.projectIcon.data : '');
const isOpen = (project) => project && project.deletedStatusKey !== 1 && project.deletedStatusKey !== 2 && !project.isRestrict;

const loadProjects = (companyId) => {
    if (state.companyId === companyId && state.loading) return state.loading;
    state.companyId = companyId;
    state.sprintsByProject = {};
    state.loading = apiRequest('get', env.PROJECT)
        .then((response) => {
            const body = (response && response.data) || [];
            state.projects = (Array.isArray(body) ? body : body.data || []).filter(isOpen);
        })
        .catch(() => { state.projects = []; });
    return state.loading;
};

const loadSprints = (projectId) => {
    if (state.sprintsByProject[projectId]) return Promise.resolve();
    state.sprintsByProject[projectId] = [];
    return apiRequest('get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${projectId}?collection=sprints`)
        .then((response) => {
            const body = (response && response.data) || [];
            state.sprintsByProject[projectId] = (Array.isArray(body) ? body : body.data || []).filter((sprint) => sprint && !sprint.deletedStatusKey);
        })
        .catch(() => { state.sprintsByProject[projectId] = []; });
};

export function useReportOptions(companyId) {
    const { getters } = useStore();
    const { getUser } = useGetterFunctions();
    const cid = () => String((companyId && companyId.value) || companyId || '');

    const ready = () => loadProjects(cid());

    /* Lists are read per project, so only for the projects in view: the chosen ones, or every project when none is. */
    const loadListsFor = async (projectIds = []) => {
        await ready();
        const ids = (projectIds.length ? projectIds : state.projects.map((p) => String(p._id))).slice(0, 40);
        await Promise.all(ids.map(loadSprints));
    };

    const projectById = computed(() => Object.fromEntries(state.projects.map((p) => [String(p._id), p])));

    const people = computed(() => (getters['settings/companyUsers'] || [])
        .filter((seat) => seat && seat.userId && seat.isDelete !== true)
        .map((seat) => ({ value: String(seat.userId), label: (getUser(seat.userId) || {}).Employee_Name || '' }))
        .filter((option) => option.label)
        .sort(byLabel));

    const projects = computed(() => state.projects
        .map((p) => ({ value: String(p._id), label: p.ProjectName || '', color: colorOf(p) }))
        .sort(byLabel));

    const lists = computed(() => Object.entries(state.sprintsByProject)
        .flatMap(([projectId, sprints]) => sprints.map((sprint) => ({
            value: String(sprint._id),
            label: `${sprint.name || ''} · ${(projectById.value[projectId] || {}).ProjectName || ''}`,
            color: colorOf(projectById.value[projectId]),
        })))
        .sort(byLabel));

    const statuses = computed(() => uniqueBy(state.projects.flatMap((p) => p.taskStatusData || []).filter((s) => s && s.name && !s.isDeleted), (s) => s.name)
        .map((s) => ({ value: s.name, label: s.name, color: s.textColor || '' }))
        .sort(byLabel));

    const tags = computed(() => uniqueBy(state.projects.flatMap((p) => p.tagsArray || []).filter((tag) => tag && tag.uid && tag.tagName), (tag) => tag.uid)
        .map((tag) => ({ value: String(tag.uid), label: tag.tagName, color: tag.tagBgColor || '' }))
        .sort(byLabel));

    const labelOf = (field, value) => {
        const source = { people, projects, lists, status: statuses, tags }[field];
        const found = source ? source.value.find((option) => option.value === value) : null;
        return found ? found.label : value;
    };

    return { ready, loadListsFor, projectById, people, projects, lists, statuses, tags, labelOf, rawProjects: computed(() => state.projects) };
}
