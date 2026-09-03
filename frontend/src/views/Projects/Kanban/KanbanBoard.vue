<template>
    <div class="kanban-board style-scroll-6-px ah-scroll">
        <div
            v-for="(column, columnIndex) in columns"
            :key="column.key"
            class="kanban-column"
            :class="{ 'kanban-column--danger': isBlockedColumn(column) }"
            @drop.prevent="onDrop(columnIndex)"
        >
            <!-- Card Area -->
            <div class="kanban-card-wrapper">
                <div class="column-head column-head-wrap">
                    <span class="status-color-dot" :style="`background-color: ${column.textColor || '#000'}`"></span>
                    <span class="column-title" :title="column.name">{{ column.name }}</span>
                    <button type="button" class="task-count" :title="$t('ProjectsV2.wip_set')" @click.stop="wipFor = wipFor === column.key ? '' : column.key">{{ tasksCount(column) }}</button>
                    <span class="column-head__spacer"></span>
                    <span v-if="atWipLimit(column)" class="wip-chip">{{ $t('ProjectsV2.wip_chip', { n: tasksCount(column), limit: wipLimit(column) }) }}</span>
                    <div v-if="wipFor === column.key" class="ah-pop wip-pop" @click.stop>
                        <div class="ah-label">{{ $t('ProjectsV2.wip_limit') }}</div>
                        <input class="ah-input" type="number" min="0" :value="wipLimit(column) || ''" :placeholder="$t('ProjectsV2.wip_none')" @change="setWipLimit(column, $event.target.value)">
                    </div>
                    <img class="cursor-pointer add-task-icon" src="@/assets/images/svg/pluss.svg" alt="addTask" @click="showAddInput(column.key)">
                </div>
                <div class="add-task-section" v-if="activeColumnId === column.key" :id="column.key">
                    <BoardViewTaskCreateVue :data="column" :groupValue="groupValue" @toggle="(val) => showAddInput(val)" :sprintData="{}" :sprintId="sprintId" />
                </div>

                <!-- Tasks List -->
                <Draggable 
                    class="kanban-cards"
                    :list="column.tasksArray"
                    group="tasks"
                    item-key="id"
                    @start="onDragStart"
                    @change="updateEvent($event, column)"
                    @scroll="checkScroll($event, column)"
                    :style="`max-height: ${columnMaxHeight(column.key)};`"
                    :disabled="isDisabled"
                    :delay="clientWidth <= 767 ? 250 : 0"
                    :delayOnTouchOnly="true"
                >
                    <template #item="{ element }">
                        <div
                            class="kanban-card hover-bg-light-lavender"
                            :class="{ 'is-agent-run': !!runFor(element._id) }"
                            draggable="true"
                            @dragstart="(e) => onManualDragStart(cardData, e)"
                        >
                            <BoardViewDisplayCardComponent
                                :data="element"
                                :groupValue="groupValue"
                                :isSubTask="false"
                                :agentRun="runFor(element._id)"
                                :agentProposal="proposalFor(element._id)"
                            />
                        </div>
                    </template>
                </Draggable>

                <div v-if="moreCount(column) > 0" class="more-count">+ {{ $t('ProjectsV2.more_count', { n: moreCount(column) }) }}</div>
            </div>

            <!-- Drop Area -->
            <div class="column-drop-area" :class="{ 'highlight-drop': hoveredColumnIndex === columnIndex }"></div>
        </div>
    </div>
</template>

<script setup>
import { ref, defineProps, nextTick, inject, watch, onMounted, onUnmounted, computed } from 'vue'
import Draggable from 'vuedraggable'
import { useStore } from "vuex";
import Cookies from "js-cookie";

//Cmponents
import BoardViewTaskCreateVue from "@/views/Projects/Kanban/BoardViewTaskCreate"
import BoardViewDisplayCardComponent from '@/views/Projects/Kanban/BoardViewDisplayCardComponent'

// Utils
import { useUpdateTasks } from "../helper";
import * as env from '@/config/env';
import { apiRequest } from "../../../services";
import { useCustomComposable } from "@/composable";
import { useTaskSelection } from "@/composable/useTaskSelection.js";
import { useProjectAgents } from "@/views/Projects/Kanban/useProjectAgents";

//Props
const props = defineProps({
    data: {
        type: Array,
        default: () => []
    },
    group: {
        type: Number
    },
    sprintId: {
        type: String
    }
})

// Variables
const columns = ref(props.data)
const groupValue = ref(props.group)
const activeColumnId = ref(null)
const companyId = inject("$companyId")
const projectData = inject("selectedProject")
const showArchiveVar = inject("showArchived");
const clientWidth = inject("$clientWidth");
const draggedCard = ref(null)
const hoveredColumnIndex = ref(null)
const isExternalDrop = ref(false)
const timer = ref(null)
const { dispatch, commit } = useStore()
const { updateTaskByGroup } = useUpdateTasks()
const { checkPermission } = useCustomComposable();

// The watch is shared with the project header, which owns its lifetime; the
// board only makes sure it is running for the project on screen.
const { start: startAgentWatch, runFor, proposalFor } = useProjectAgents();
watch(() => projectData.value?._id, (id) => { if (id) startAgentWatch(id); }, { immediate: true });

const selection = useTaskSelection();
const { setActiveView, setActiveProject } = selection;
setActiveView('kanban');
watch(() => projectData.value?._id, (newId) => {
    if (newId) setActiveProject(String(newId));
}, { immediate: true });

// Computed properties
const isDisabled = computed(() => {
    // 12e keeps drag on the phone; the 250ms touch delay above lets a swipe
    // scroll the column instead of picking a card up.
    const shouldDisableOnPermission = (checkPermission('task.task_list', projectData.value?.isGlobalPermission) !== true || checkPermission('task.task_status', projectData.value?.isGlobalPermission) !== true);
    const shouldDisableOnArchive = (showArchiveVar.value !== false);
    // Disable drag when multi-select is active (>=2 selected). Multi-move
    // happens via the BulkActionBar's "Move" action — keeps the drag
    // behavior unambiguous for the user.
    const shouldDisableOnMultiSelect = selection.count.value >= 2;
    const finalDisabled = shouldDisableOnPermission || shouldDisableOnArchive || shouldDisableOnMultiSelect;
    return finalDisabled;
});

const columnMaxHeight = computed(() => {
    return (key) => {
        if (clientWidth.value > 1690) {
            return activeColumnId.value === key ? '60vh': '75vh';
        } else if (clientWidth.value <= 1440 && clientWidth.value > 768 ) {
            return activeColumnId.value === key ? 'calc(77vh - 250px)': 'calc(77vh - 100px)';
        } else if (clientWidth.value >= 768) {
            return activeColumnId.value === key ? 'calc(80vh - 250px)': 'calc(80vh - 100px)';
        } else {
            return activeColumnId.value === key ? 'calc(74vh - 240px)' : 'calc(74vh - 100px)';
        }
    }
})

watch(() => (props.data), (value) => {
    columns.value = value;
    init();
})

watch(() => (props.group), (value) => {
    groupValue.value = value;
})

onMounted(() => {
    init();
})

function init() {
    let taskWithoutFilter = []
    let taskArray = [];

    columns.value.forEach((data) => {
        let withoutIndexTask = data.tasksArray?.filter((x) => {
            return (x[data.indexName] === undefined || x[data.indexName] === null) && x.TaskKey !== '--'
        })
        if (withoutIndexTask?.length > 0) {
            withoutIndexTask.map((x) => taskWithoutFilter.push({ data: x._id, item: data, taskKey: x.TaskKey }))
            withoutIndexTask.map((x) => taskArray.push(x));
        }
    })

    if (!(taskWithoutFilter.length === 0 && taskArray.length === 0)) {
        var newObj = { pid: projectData.value._id, sprintId: columns.value[0].sprintId || props.sprintId, tasksArray: taskArray, indexName: columns.value[0].indexName };
        commit("projectData/mutateTaskIndex", newObj)
        let count = 0;

        let countFunction = async (row) => {
            if (count >= taskWithoutFilter.length) {
                return;
            } else {
                if (row.taskKey != '--') {
                    await apiRequest("post", env.ONLOAD_UPDATE_TASK_INDEX, {
                        taskUpdate: row,
                        companyId: companyId.value,
                    }).then(() => {
                        count++;
                        countFunction(taskWithoutFilter[count])
                    })
                    .catch((error) => {
                        console.error("ERROR in update project history: ", error);
                        count++;
                        countFunction(taskWithoutFilter[count])
                    })
                } else {
                    count++;
                    countFunction(taskWithoutFilter[count]);
                }
            }
        }
        countFunction(taskWithoutFilter[count])
    }
}

function debouncer(timeout = 1000) {
    return new Promise((resolve) => {
        if(timer.value) {
            clearTimeout(timer.value);
        }
        timer.value = setTimeout(() => {
            resolve();
        }, timeout);
    })
}

const onDragStart = (evt) => {
    const draggedElement = evt.item?._underlying_vm_;
    if (draggedElement) {
        draggedCard.value = draggedElement;
        isExternalDrop.value = true;
    }
}

const onManualDragStart = (card, event) => {
    if (!event.dataTransfer.types.includes('application/json')) {
        draggedCard.value = card
        isExternalDrop.value = true
        event.dataTransfer.setData("application/json", JSON.stringify(card))
    }
}

const onDrop = (columnIndex) => {
    if (!draggedCard.value || !isExternalDrop.value) return

    columns.value.forEach((col) => {
        const index = col.tasksArray.findIndex((task) =>
            task._id === draggedCard.value._id
        )
        if (index !== -1) {
            col.tasksArray.splice(index, 1)
        }
    })

    const droppedCard = draggedCard.value
    columns.value[columnIndex].tasksArray.push(droppedCard)

    updateTaskByGroup(droppedCard, columns.value[columnIndex], groupValue.value, null, true)

    draggedCard.value = null
    isExternalDrop.value = false
    hoveredColumnIndex.value = null
}

const showAddInput = (columnId) => {
    if (activeColumnId.value) {
        activeColumnId.value = "";
    } else {
        activeColumnId.value = columnId;
    }

    if (activeColumnId.value) {
        nextTick(() => {
            document.getElementById(columnId).scrollIntoView();
        })
    }
}

function getPaginatedTasks(params) {
    dispatch("projectData/getPaginatedTasks", params)
    .catch((error) => {
        console.error(`ERROR in get tasks   `, error);
    })
}

const updateEvent = (event, task) => {
    isExternalDrop.value = false;
    let element = null;
    let index = null;
    if (event.added) {
        element = event.added.element
        index = event.added.newIndex
    }
    else if (event.moved) {
        element = event.moved.element
        index = event.moved.newIndex
    }
    if (element) {
        if (event.added) {
            updateTaskByGroup(element, task, groupValue.value, null, true);
        }
        let relevantIndex
        let tempIndex;
        let taskDt = columns.value.find((x) => x.searchValue === task.searchValue);
        if (index === 0 && taskDt.tasksArray.length === 1) {
            tempIndex = 0
        }
        else if ((index + 1) === taskDt.tasksArray.length) {
            tempIndex = taskDt.tasksArray[taskDt.tasksArray.length - 2][task.indexName] + 65536
        } else {
            if (index === 0) {
                tempIndex = taskDt.tasksArray[1][task.indexName] - 65536
            } else {
                tempIndex = (taskDt.tasksArray[index - 1][task.indexName] + taskDt.tasksArray[index + 1][task.indexName]) / 2
            }
        }
        if (taskDt.tasksArray.length !== 1 && taskDt.tasksArray.length !== 0) {
            if (index === 0) {
                relevantIndex = taskDt.tasksArray[1][task.indexName]
            } else {
                relevantIndex = taskDt.tasksArray[index - 1][task.indexName]
            }
        } else {
            relevantIndex = 0
        }
        let UpdateData
        let uniqueeTime = new Date().getTime()
        if (groupValue.value === 0) {
            const updatedStatus = {
                'text': task.name,
                'key': task.key,
                'type': task.type,
            }
            UpdateData = {
                status: updatedStatus,
                'statusType': task.type,
                'statusKey': task.key,
                'updateToken': { user: Cookies.get('accessToken'), timeStamp: uniqueeTime },
                'islocalSnapStop': true
            }
        }
        if (groupValue.value === 2) {
            UpdateData = {
                Task_Priority: task.value,
                'updateToken': { user: localStorage.getItem('updateToken'), timeStamp: uniqueeTime },
                'islocalSnapStop': true,
                Updated_At: new Date()
            }
        }
        if (groupValue.value === 1) {
            UpdateData = {
                AssigneeUserId: task.value !== '' ? task.value.split("_") : [],
                'updateToken': { user: localStorage.getItem('updateToken'), timeStamp: uniqueeTime },
                'islocalSnapStop': true
            }
        }
        if (groupValue.value === 3) {
            UpdateData = {
                DueDate: new Date(task.searchValue * 1000),
                'updateToken': { user: localStorage.getItem('updateToken'), timeStamp: uniqueeTime },
                Updated_At: new Date(),
                'islocalSnapStop': true
            }
        }
        apiRequest("post", env.UPDATA_TASK_INDEX, {
            relevantIndex: relevantIndex,
            projectId: element.ProjectID,
            companyId: element.CompanyId,
            taskId: element._id,
            isFirst: index === 0 ? true : false,
            isFirstWithRecord: (index === 0 && taskDt.tasksArray.length !== 1 && taskDt.tasksArray.length !== 0) ? true : false,
            indexName: task.indexName,
            sprintId: element.sprintId,
            relevantKey: task.searchValue,
            searchKey: task.searchKey,
            taskKey: element.TaskKey,
            updateData: UpdateData
        }).then(() => {
            element = { ...element, ...UpdateData, [task.indexName]: tempIndex }
            element.updateTimeStamp = uniqueeTime;
            var newObj = { pid: projectData.value._id, sprintId: columns.value[0].sprintId, task: element };
            commit("projectData/mutateTaskForDragAndDrop", newObj)
        })
        .catch((error) => {
            console.error("ERROR in update project history: ", error);
        })
    }
}

function checkScroll(e,task) {
    debouncer(100).then(() => {
        if(e.target.scrollTop >= (e.target.scrollHeight - e.target.clientHeight) - 200) {
            getPaginatedTasks({ pid: projectData.value._id, sprintId: task.sprintId, item: task, fetchNew: true });
        }
    })
    .catch((err) => {
        console.error("error", err);
    })
}

const tasksCount = (column) => {
    const key = `${column?.searchKey}_${column?.searchValue}`;
    const countFromTotal = column?.totalTaskCounts?.[key];
    return countFromTotal !== undefined && countFromTotal !== 0
        ? countFromTotal
        : column?.tasksArray?.length || 0;
};

// The column header counts every task in the status; the list itself is paged.
const moreCount = (column) => Math.max(0, tasksCount(column) - (column?.tasksArray?.length || 0));

const isBlockedColumn = (column) => /block/i.test(String(column?.name || ''));

// WIP limits have no field on the status document yet, so they are the viewer's
// own setting until one exists; `column.wipLimit` is read first so a future
// per-status limit takes over without touching this component.
const WIP_KEY = 'ah.wip';
const wipFor = ref('');
const wipLimits = ref({});

const readWipLimits = () => {
    try {
        wipLimits.value = JSON.parse(localStorage.getItem(`${WIP_KEY}.${projectData.value?._id}`) || '{}');
    } catch (error) {
        wipLimits.value = {};
    }
};
readWipLimits();
watch(() => projectData.value?._id, readWipLimits);

const wipLimit = (column) => Number(column?.wipLimit || wipLimits.value[column?.key] || 0);
const atWipLimit = (column) => {
    const limit = wipLimit(column);
    return limit > 0 && tasksCount(column) >= limit;
};
const setWipLimit = (column, value) => {
    const limit = Math.max(0, Number(value) || 0);
    wipLimits.value = { ...wipLimits.value, [column.key]: limit };
    localStorage.setItem(`${WIP_KEY}.${projectData.value?._id}`, JSON.stringify(wipLimits.value));
    wipFor.value = '';
};

// "+ Task" in the project header (ProjectHeader) bumps this counter; the board
// answers by opening the first column's create row.
const addTaskRequest = inject('addTaskRequest', null);
if (addTaskRequest) {
    watch(addTaskRequest, () => {
        const first = columns.value[0];
        if (first) showAddInput(first.key);
    });
}

const closeWipPop = () => { wipFor.value = ''; };
document.addEventListener('click', closeWipPop);
onUnmounted(() => document.removeEventListener('click', closeWipPop));
</script>
<style src="./new-style.css" scoped />