<template>
    <div :class="clientWidth > 767 ? 'h-100' : ''">
        <div class="task-detail-body-header">
            <TabListHeader
                :tabs="tabs"
                :activeTab="activeTab"
                @changeTab="changeTab"

                :commentCounts="myCounts"
            />
        </div>
        <div :class="`bg-light-gray mt--15px taskdetail__leftright-wrapper ${clientWidth <= 767 ? '' : 'd-flex'}`">
            <div :class="`task-detail-leftside task__detail-padding ${clientWidth <= 767 ? activeTab === 'comment' ? 'task-detail-leftside-comment' : 'task-detail-leftside-allother' : ''}`" :style="{'width': (clientWidth > 767 ? 'calc(100% - 375px)' : 'width:95%'), padding: ['comment', 'activity'].includes(activeTab) ? '' : '20px 18.5px'}">
                <TaskDetailTab
                    v-if="activeTab === 'task-detail-tab'"
                    :task="task"
                    @openSeeAll="$emit('open', 'filesLinks')"
                    :isSupport="isSupport"
                    :subTasksArray="subTasksArray"
                    :isMainSpinner="isSpinner"
                    :docsRefreshKey="docsRefreshKey"
                    @openDoc="openDoc"
                />
                <Comments
                    v-else-if="activeTab === 'comment' && Object.keys(projectData).length && Object.keys(task).length"
                    :taskId="task?._id"
                    :parentTaskId="task?.ParentTaskId"
                    :sprintId="task?.sprintId"
                    :folderId="task?.folderObjId || null"
                    :userIds="commentUsers"
                    :watchers="[...(task?.watchers || [])]"
                    :title="task?.TaskName"
                    :checklistArray="task?.checklistArray"
                    :sprintName="task?.sprintArray?.name"
                    :folderName="task?.sprintArray?.folderName"
                    :productData="{customerId, productName}"
                    :forSupport="isSupport || isSupportProject"
                    :creator="{uid: task?.Task_Leader, date: task?.createdAt}"
                />
                <ActivityLog
                    v-else-if="activeTab === 'activity' && !isSupport"
                    :dataObj="task"
                    :fromProject="false"
                    :isMainSpinner="isSpinner"
                />
                <TimeLog v-else-if="activeTab === 'time-log'" :task="task" :isMainSpinner="isSpinner" />
                <TaskDetailRightSide
                    v-if="clientWidth <= 767 ? activeTab === 'task-detail-tab' : false"
                    :task="task"
                    :parentTask="parentTask"
                    :taskStatusIndex="props.taskStatusIndex"
                    :zIndexAssigne="props.zIndexAssigne"
                    :zIndexPriority="props.zIndexPriority"
                    :zIndexEstimate="props.zIndexEstimate"
                    :isSupport="isSupport"
                    :isMainSpinner="isSpinner"
                    :clientWidth="clientWidth"
                />
            </div>
            <TaskDetailRightSide
                v-if="clientWidth > 767"
                :task="task"
                :parentTask="parentTask"
                :taskStatusIndex="props.taskStatusIndex"
                :zIndexAssigne="props.zIndexAssigne"
                :zIndexPriority="props.zIndexPriority"
                :zIndexEstimate="props.zIndexEstimate"
                :isSupport="isSupport"
                :isMainSpinner="isSpinner"
            />

            <!-- Opened from the task's Linked Docs section. Mounted here, next to the tab,
                 so it survives while the doc is open. -->
            <PagesPanel
                v-if="projectData && Object.keys(projectData || {}).length"
                v-model="showDocs"
                :projectData="projectData"
                :openDocId="openDocId"
            />
        </div>
    </div>
</template>

<script setup>
    import { ref, defineProps, computed, inject, onMounted, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { useStore } from 'vuex';

    import TabListHeader from '@/components/molecules/TabListHeader/TabListHeader.vue'
    import TaskDetailTab from '@/components/molecules/TaskDetailTab/TaskDetailTab.vue'
    import TaskDetailRightSide from '@/components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue'
    import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue'
    import Comments from '@/views/Projects/Comments/Comments.vue'
    import ActivityLog from '@/components/templates/ActivityLog/ActivityLog.vue'
    import TimeLog from '@/views/TimeLog/TimeLog.vue'
    import { useCustomComposable } from '@/composable';

    const {getters} = useStore();
    const { checkPermission } = useCustomComposable();

    const props = defineProps({
        task: Object,
        clientWidth: Number,
        parentTask: Object,
        taskStatusIndex: {
            type: Number,
            default: 7
        },
        zIndexAssigne: {
            type: Number,
            default: 7
        },
        zIndexPriority: {
            type: Number,
            default: 7
        },
        zIndexEstimate: {
            type: Number,
            default: 7
        },
        isSupport:{
            type:Boolean,
            default:false
        },
        isSpinner:{
            type:Boolean,
            default:false
        },
        subTasksArray: {
            type: Array,
            default: () => []
        }
    });

    const sprintData = computed(() => {
        let sprintData = false;
        if (projectData.value && props.task) {
            sprintData = props.task.folderObjId ? projectData.value?.sprintsfolders?.[props.task.folderObjId]?.sprintsObj?.[props.task.sprintId] : projectData.value?.sprintsObj?.[props.task.sprintId]
        }

        return sprintData || null;
    })

    // Docs panel, opened from the task's Linked Docs section. The id is handed to the panel
    // so it opens ON that doc rather than on an empty "pick something" state — the click
    // already said which one.
    const showDocs = ref(false);
    const openDocId = ref('');
    const openDoc = (doc) => {
        if (!doc || !doc._id) return;
        openDocId.value = String(doc._id);
        showDocs.value = true;
    };
    // A doc can be renamed or deleted while the panel is open, so the list that opened it
    // is re-read on the way out rather than left showing the old title.
    const docsRefreshKey = ref(0);
    watch(showDocs, (open, wasOpen) => {
        if (wasOpen && !open) docsRefreshKey.value += 1;
    });

    const router = useRouter();
    const route = useRoute();
    watch(route, (newVal) => {
        activeTab.value = newVal.query.detailTab
    })

    const projectData = inject("selectedProject");
    const users = computed(() => getters["settings/companyUsers"]?.map((x) =>x.userId));

    const activeTab = ref('');
    const isSupportProject = computed(() => process.env.VUE_APP_SUPPORT_PROJECTID === projectData.value._id)

    const customerId = ref(props.task?.customField?.[process.env.VUE_APP_CUSTOMFIELDID]?.fieldValue);
    const productName = ref(props.task?.customField?.[process.env.VUE_APP_CUSTOMFIELDPRODUCTID]?.fieldValue);

    onMounted(() => {
        if(!route.query?.detailTab) {
            router.replace({ name: route.name, params: { ...route.params }, query: { ...route.query, detailTab: 'task-detail-tab' } })
        }
        activeTab.value = route.query.detailTab ? route.query.detailTab : 'task-detail-tab'
    })

    const myCounts = computed(() => getters["users/myCounts"]?.data?.[`task_${projectData.value._id}_${props.task.sprintId}_${props.task._id}_comments`] || 0)

    const tabs = ref({
        ...(checkPermission('task.task_details',projectData.value?.isGlobalPermission) === true && {'task-detail-tab': {
            name: 'task_details',
            activeIcon: require('@/assets/images/svg/tab1Icon.svg'),
            inactiveIcon: require('@/assets/images/svg/tab1Icon.svg'),
        }}),
        ...(checkPermission('task.task_comment',projectData.value?.isGlobalPermission) === true && {'comment': {
            name: 'Comments',
            activeIcon:require('@/assets/images/svg/tab2Icon.svg'),
            inactiveIcon:require('@/assets/images/svg/tab2Icon.svg'),
        }}), 
        ...(checkPermission('task.task_activity_log',projectData.value?.isGlobalPermission) === true && {'activity':{
            name: 'activity_log',
            activeIcon:require('@/assets/images/svg/tab3Icon.svg'),
            inactiveIcon:require('@/assets/images/svg/tab3Icon.svg'),
        }}), 
        'time-log':{
            name: 'time_log',
            activeIcon:require('@/assets/images/svg/tab4Icon.svg'),
            inactiveIcon:require('@/assets/images/svg/tab4Icon.svg'),
        }
    });

    const changeTab = (tab) => {
        activeTab.value = tab;
        router.replace({ name: route.name, params: { ...route.params }, query: { ...route.query, detailTab: tab } })
    }

    const commentUsers = computed(() => {
        let tmp = [];

        if(sprintData.value?.private) {
            tmp = Array.from(new Set([...(sprintData.value?.AssigneeUserId || []), ...(props.task.watchers || [])]))
        } else if(projectData.value?.isPrivateSpace) {
            tmp = [...(projectData.value?.AssigneeUserId || [])]
        } else {
            tmp = [...(users.value || [])]
        }
        return tmp;
    })
</script>
<style src="./style.css"></style>