import { computed, inject, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from 'vue-toast-notification';
import { i18n } from '@/locales/main';
import { useProjectsHelper } from '../helper';

const byId = (list, id) => (list || []).find((item) => String(item._id) === String(id));

const defaultTab = (project, current) => {
    const views = project?.ProjectRequiredComponent || [];
    if (views.find((x) => x.keyName === current)) return current;
    const view = views.find((e) => e.setAsDefault) || views.find((e) => e.viewStatus) || views[0];
    return view ? view.keyName : 'ProjectListView';
};

/* The sprint/folder tree of the open project. Sprints and folders are fetched once
   per project into the store (projectData/sprints|folders) and folded into the
   project document so every view reads project.sprintsObj / sprintsfolders. */
export function useProjectTree(projectData) {
    const { getters, commit, dispatch } = useStore();
    const route = useRoute();
    const router = useRouter();
    const $toast = useToast();
    const t = i18n.global.t;
    const userId = inject('$userId');
    const companyId = inject('$companyId');
    const { projects } = useProjectsHelper();

    const sprintLoading = ref(false);
    const companyUserDetail = computed(() => getters['settings/companyUserDetail']);

    function cached(kind, id) {
        const store = getters[`projectData/${kind}`] || {};
        return Object.prototype.hasOwnProperty.call(store, id) ? store[id] : null;
    }

    const fetchSprints = (id, forceRefresh) => (!forceRefresh && cached('sprints', id)) || dispatch('projectData/setSprints', { projectId: id });
    const fetchFolders = (id) => cached('folders', id) || dispatch('projectData/setFolders', { projectId: id });

    async function loadSprintFolderData(id, isUpdate = false, forceRefresh = false) {
        if (!id) return;
        if (!isUpdate) sprintLoading.value = true;
        try {
            const [sprintsResult, foldersResult] = await Promise.all([fetchSprints(id, forceRefresh), fetchFolders(id)]);
            const project = byId(projects.value, id);
            if (!project) return;

            const folders = (foldersResult || []).reduce((acc, folder) => {
                if (folder.projectId !== id) return acc;
                acc[folder._id] = { folderId: folder._id, name: folder.name, sprintsObj: {}, deletedStatusKey: folder.deletedStatusKey, legacyId: folder?.legacyId || '', id: folder._id, _id: folder._id };
                return acc;
            }, {});
            const sprints = {};
            (sprintsResult || []).forEach((sprint) => {
                if (sprint.projectId !== id) return;
                sprint.id = sprint._id;
                if (sprint.folderId && folders[sprint.folderId]) {
                    sprint.folderName = folders[sprint.folderId].name;
                    folders[sprint.folderId].sprintsObj[sprint._id] = sprint;
                } else if (!sprint.folderId) {
                    sprints[sprint._id] = sprint;
                }
            });

            project.sprintsObj = sprints;
            project.sprintsfolders = { ...(project.sprintsfolders || {}), ...folders };
            commit('projectData/mutateProjects', [{ snap: null, privateSnap: false, userId: userId.value, roleType: companyUserDetail.value?.roleType, op: 'modified', data: { ...project } }]);
        } catch (error) {
            console.error('ERROR in loading sprints and folders', error);
        } finally {
            sprintLoading.value = false;
        }
    }

    function selectProject(data, updateRoute = false) {
        const project = byId(projects.value, data?._id) || data;
        if (!project?._id) return;
        if (updateRoute) {
            router.push({ name: 'Project', params: { cid: companyId.value, id: project._id }, query: { ...route.query, tab: defaultTab(project, route.query?.tab) } });
        }
        commit('projectData/mutateCurrentProjectDetails', project);
        projectData.value = project;
        if (project.isGlobalPermission === false) loadSprintFolderData(project._id);
    }

    // A project created seconds ago is in the store before it reaches the list.
    function storeProject(id) {
        const known = getters['projectData/projects'];
        const item = byId(Array.isArray(known) ? known : known?.data, id);
        return item ? { ...item, _id: item._id || item.id } : null;
    }

    /* Open the project the URL names; fall back to the first one and say so, since a
       silent fallback made every stale deep link look like it had opened what was clicked. */
    function resolveRouteProject() {
        if (!projects.value?.length) return;
        const wanted = route.params?.id;
        if (wanted && String(projectData.value?._id) === String(wanted)) return;
        const routed = wanted ? (byId(projects.value, wanted) || storeProject(wanted)) : null;
        if (wanted && !routed) $toast.info(t('Toast.The_project_not_found'), { position: 'top-right' });
        selectProject(routed || projects.value[0], !routed);
    }

    watch(projects, resolveRouteProject, { deep: true });
    watch(() => route.params?.id, (id) => { if (id) resolveRouteProject(); });
    watch(() => getters['projectData/sprints'], () => { if (projectData.value?._id) loadSprintFolderData(projectData.value._id, true); });
    watch(() => getters['projectData/folders'], () => { if (projectData.value?._id) loadSprintFolderData(projectData.value._id, true); });
    onMounted(resolveRouteProject);

    return { sprintLoading, loadSprintFolderData, selectProject, resolveRouteProject };
}
