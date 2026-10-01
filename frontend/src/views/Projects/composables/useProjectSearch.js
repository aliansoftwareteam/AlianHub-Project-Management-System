import { ref, computed, inject, watch } from 'vue';
import { useStore } from 'vuex';
import { useCustomComposable } from '@/composable';
import { clearFilterSignal } from './taskFilterSignal';
import { ALL, cleanDoneBy, doneByMatch } from '@/components/molecules/Provenance/doneByQuery';
import { agentTaskIds } from './agentWork';
import { agentWorkMatch } from './agentWorkQuery';

const withComparisons = (rows) => rows.map((row) => ({ ...row, comparisonsData: [row.comparison] }));

export function useProjectSearch(projectData, showArchived, { buildFilterQuery = () => '' } = {}) {
    const { commit, dispatch, getters } = useStore();
    const { checkPermission, debounce } = useCustomComposable();
    const userId = inject('$userId');

    const taskSearch = ref('');
    const taskNameSearch = ref(true);
    const taskKeySearch = ref(false);
    const taskDescriptionSearch = ref(false);
    const filterUsers = ref([]);
    const filterQuery = ref({});
    const filterRows = ref([]);
    const doneBy = ref(ALL);
    const agentWorking = ref(false);
    const searchTask = ref(false);
    const collapsed = ref(true);
    const groupBy = ref(0);
    const userSidebar = ref(false);

    const showTasks = computed(() => checkPermission('task.show_tasks', projectData.value.isGlobalPermission, { gettersVal: getters }));

    /**
     * Whether this search may see everyone's tasks — decided EXACTLY as the task list
     * decides it (views/Projects/helper.js -> store/ProjectData/actions.js).
     *
     * The list only applies the own-tasks-only restriction when the project carries its OWN
     * permissions; on a project using the global rules it passes `true` and shows
     * everything. Search applied the restriction unconditionally, so a role whose global
     * `task.show_tasks` is 1 saw every task in the list and only their own the moment they
     * typed in the search box. Owner/Admin never hit it — checkPermission short-circuits
     * roleType 1|2 to `true` — which is why it only ever showed up for other roles.
     */
    const showAllTasks = computed(() => (
        projectData.value.isGlobalPermission === false ? showTasks.value : true
    ));

    // The same accepted values the store uses: undefined, true and 2 all mean "everyone's".
    // Anything else — including null, a role the rule does not name — narrows to your own.
    const seesEveryonesTasks = computed(() => (
        showAllTasks.value === undefined || showAllTasks.value === true || showAllTasks.value === 2
    ));

    function resetFilters() {
        groupBy.value = 0;
        filterUsers.value = [];
        taskSearch.value = '';
        doneBy.value = ALL;
        agentWorking.value = false;
        searchTask.value = false;
        filterQuery.value = '';
        filterRows.value = [];
        collapsed.value = true;
        searchMongoDB();
    }

    const me = () => userId?.value;

    function viewState() {
        return {
            groupBy: groupBy.value,
            me: Boolean(me()) && filterUsers.value.includes(me()),
            assignees: filterUsers.value.filter((id) => id !== me()),
            search: taskSearch.value,
            searchIn: { name: taskNameSearch.value, key: taskKeySearch.value, description: taskDescriptionSearch.value },
            doneBy: doneBy.value,
            subtasks: collapsed.value ? 'collapsed' : 'expanded',
            filters: filterRows.value,
        };
    }

    function applyViewState(state) {
        groupBy.value = state.groupBy;
        filterUsers.value = [...(state.me && me() ? [me()] : []), ...state.assignees.filter((id) => id !== me())];
        taskSearch.value = state.search;
        taskNameSearch.value = state.searchIn.name;
        taskKeySearch.value = state.searchIn.key;
        taskDescriptionSearch.value = state.searchIn.description;
        doneBy.value = cleanDoneBy(state.doneBy);
        collapsed.value = state.subtasks !== 'expanded';
        filterRows.value = state.filters;
        filterQuery.value = state.filters.length ? buildFilterQuery(withComparisons(state.filters)) : '';
        searchMongoDB();
    }

    function clearAllFilters() {
        taskSearch.value = '';
        filterUsers.value = [];
        filterQuery.value = '';
        filterRows.value = [];
        doneBy.value = ALL;
        agentWorking.value = false;
        clearFilterSignal.value += 1;
        searchMongoDB();
    }

    function toggleSearch() {
        if (taskDescriptionSearch.value === false && taskKeySearch.value === false) {
            taskNameSearch.value = true;
        }
    }

    function searchMongoDB() {
        const doneByCondition = doneByMatch(doneBy.value);
        if (!taskSearch.value.trim().length && !filterUsers.value.length && !showArchived.value && !Object.keys(filterQuery.value).length && !doneByCondition && !agentWorking.value) {
            commit('projectData/mutateSearchTask', { data: [], op: 'added' });
            searchTask.value = false;
            return;
        }

        // A role the project's own rules do not name gets no tasks at all — getSprintTasks
        // returns without fetching (helper.js). Search must not be the way around a list
        // that refuses to load, so it returns nothing here rather than the caller's own.
        if (showTasks.value === null && projectData.value.isGlobalPermission === false) {
            commit('projectData/mutateSearchTask', { data: [], op: 'added' });
            searchTask.value = true;
            return;
        }

        const query_by = {};
        const searchStr = taskSearch.value ? taskSearch.value.toString() : '';
        const andOr = '$or';
        query_by[andOr] = [];
        if (taskNameSearch.value) {
            query_by[andOr].push({ TaskName: { $regex: searchStr, $options: 'i' } });
        }
        if (taskKeySearch.value) {
            query_by[andOr].push({ TaskKey: { $regex: searchStr, $options: 'i' } });
        }
        if (taskDescriptionSearch.value) {
            query_by[andOr].push({ rawDescription: { $regex: searchStr, $options: 'i' } });
        }
        searchTask.value = true;
        const query = [
            {
                $match: {
                    $and: [
                        {
                            $and: [
                                { ProjectID: { objId: { $in: [projectData.value._id] } } },
                                { deletedStatusKey: { $in: [showArchived.value ? 2 : 0] } },
                            ],
                        },
                    ],
                },
            },
        ];

        if (filterQuery.value) {
            query[0].$match.$and.push(filterQuery.value);
        }

        if (searchStr && searchStr.length) {
            query[0].$match.$and.push(query_by);
        }

        if (filterUsers.value && filterUsers.value.length > 0) {
            query[0].$match.$and.push({ AssigneeUserId: { $in: filterUsers.value } });
        }

        if (doneByCondition) {
            query[0].$match.$and.push(doneByCondition);
        }

        if (agentWorking.value) {
            query[0].$match.$and.push(agentWorkMatch(agentTaskIds.value));
        }

        if (!seesEveryonesTasks.value) {
            query[0].$match.$and.push({ AssigneeUserId: { $in: [userId.value] } });
        }

        dispatch('projectData/searchTask', { query, showArchived: showArchived.value }).catch((error) => {
            console.error('ERROR in search tasks: ', error);
        });
    }

    function manageFilterUsers(uid = null) {
        if (uid) {
            if (filterUsers.value.includes(uid)) {
                filterUsers.value = filterUsers.value.filter((x) => x !== uid);
            } else {
                filterUsers.value.push(uid);
            }
        }

        searchMongoDB();
    }

    const applyFilter = (query) => {
        filterQuery.value = query;
        searchMongoDB();
    };

    const setDoneBy = (value) => {
        doneBy.value = cleanDoneBy(value);
        searchMongoDB();
    };

    const setAgentWorking = (on) => {
        agentWorking.value = Boolean(on);
        searchMongoDB();
    };

    const clearFilter = () => {
        filterQuery.value = '';
        filterRows.value = [];
        searchMongoDB();
    };

    watch(taskSearch, debounce(() => {
        searchMongoDB();
    }, 1000));

    watch([projectData, showArchived], () => {
        searchMongoDB();
    });

    watch(() => agentTaskIds.value.slice().sort().join(), () => {
        if (agentWorking.value) searchMongoDB();
    });

    return {
        taskSearch,
        taskNameSearch,
        taskKeySearch,
        taskDescriptionSearch,
        filterUsers,
        filterQuery,
        filterRows,
        doneBy,
        agentWorking,
        searchTask,
        collapsed,
        groupBy,
        userSidebar,
        showTasks,
        resetFilters,
        viewState,
        applyViewState,
        clearAllFilters,
        toggleSearch,
        searchMongoDB,
        manageFilterUsers,
        applyFilter,
        setDoneBy,
        setAgentWorking,
        clearFilter,
    };
}
