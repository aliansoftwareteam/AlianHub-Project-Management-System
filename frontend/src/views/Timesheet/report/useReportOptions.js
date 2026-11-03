import { computed, reactive, watch } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from '@/composable';
import { projectsForPeople, basisProjects, keepAllowed, pickedFirst } from './reportFacets';

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
            projectId,
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

    const statusesOf = (list) => uniqueBy(list.flatMap((p) => p.taskStatusData || []).filter((s) => s && s.name && !s.isDeleted), (s) => s.name)
        .map((s) => ({ value: s.name, label: s.name, color: s.textColor || '' }));
    const tagsOf = (list) => uniqueBy(list.flatMap((p) => p.tagsArray || []).filter((tag) => tag && tag.uid && tag.tagName), (tag) => tag.uid)
        .map((tag) => ({ value: String(tag.uid), label: tag.tagName, color: tag.tagBgColor || '' }));

    const facets = reactive({ key: '', workedByUser: {} });
    const loadFacets = async (people, range) => {
        const key = `${people.join(',')}|${range.start}|${range.end}`;
        if (facets.key === key) return;
        facets.key = key;
        if (!people.length) { facets.workedByUser = {}; return; }
        try {
            const body = ((await apiRequest('post', env.REPORT_FACETS, { start: range.start, end: range.end, userIds: people, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })) || {}).data || {};
            if (facets.key === key) facets.workedByUser = (body.status && body.data && body.data.projectsByUser) || {};
        } catch (error) {
            if (facets.key === key) facets.workedByUser = {};
        }
    };
    const teamsOfUser = computed(() => {
        const out = {};
        (getters['settings/teams'] || []).forEach((team) => (team.assigneeUsersArray || []).forEach((uid) => { (out[uid] = out[uid] || []).push(String(team._id)); }));
        return out;
    });

    /* The bar's options, narrowed by what is already picked: people (any or all of them) narrow the projects to the
     * ones they are on or worked in over the range, and the projects in view narrow lists, statuses and tags. Anything
     * picked stays listed, first. */
    const narrowed = (filters, range) => {
        const allowed = computed(() => projectsForPeople({
            people: filters.value.people, match: filters.value.match, projects: state.projects, workedByUser: facets.workedByUser, teamsOfUser: teamsOfUser.value,
        }));
        const basis = computed(() => basisProjects({ chosen: filters.value.projects, allowed: allowed.value, all: state.projects }));
        const basisIds = computed(() => new Set(basis.value.map((p) => String(p._id))));
        watch(() => [filters.value.people.join(','), range.value.start, range.value.end], () => loadFacets(filters.value.people, range.value), { immediate: true });
        watch(() => [...basisIds.value].join(','), () => {
            if (Object.keys(state.sprintsByProject).length) loadListsFor([...basisIds.value]);
        });
        const picked = (field) => filters.value[field] || [];
        return computed(() => ({
            people: pickedFirst(people.value, picked('people')),
            projects: pickedFirst(keepAllowed(projects.value, allowed.value, picked('projects')), picked('projects')),
            lists: pickedFirst(lists.value.filter((o) => basisIds.value.has(String(o.projectId)) || picked('lists').includes(o.value)), picked('lists')),
            status: pickedFirst(keepAllowed(statuses.value, new Set(statusesOf(basis.value).map((o) => o.value)), picked('status')), picked('status')),
            tags: pickedFirst(keepAllowed(tags.value, new Set(tagsOf(basis.value).map((o) => o.value)), picked('tags')), picked('tags')),
        }));
    };

    const labelOf = (field, value) => {
        const source = { people, projects, lists, status: statuses, tags }[field];
        const found = source ? source.value.find((option) => option.value === value) : null;
        return found ? found.label : value;
    };

    return { ready, loadListsFor, narrowed, projectById, people, projects, lists, statuses, tags, labelOf, rawProjects: computed(() => state.projects) };
}
