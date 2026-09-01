<template>
    <div class="kanban-board style-scroll-6-px">
        <div v-for="(column, columnIndex) in columns" :key="column.key" class="kanban-column" @drop.prevent="onDrop(columnIndex)">
            <!-- Card Area -->
            <div class="kanban-card-wrapper" :style="{ backgroundColor: groupValue === 0 ? column.textColor + '14' : '#f4f5f7' }">
                <!-- Add Task Section --> 
                <div class="d-flex justify-content-between align-items-center" :class="{ 'mb-10px': column.tasksArray?.length }">
                    <span class="d-flex justify-content-between align-items-center">
                        <span class="status-color-dot" :style="`background-color: ${column.textColor || '#000'}`"></span>
                        <span class="column-title">{{ column.name }}</span>
                        <span class="task-count" v-if="column.tasksArray?.length">{{ tasksCount(column) }}</span>
                    </span>
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
                    :item-key="columnItemKey"
                    @start="onDragStart"
                    @change="updateEvent($event, column)"
                    @scroll="checkScroll($event, column)"
                    :style="`max-height: ${columnMaxHeight(column.key)};`"
                    :disabled="isDisabled"
                >
                    <template #item="{ element }">
                        <div class="kanban-card hover-bg-light-lavender" draggable="true" @dragstart="(e) => onManualDragStart(cardData, e)">
                            <BoardViewDisplayCardComponent
                                :data="element"
                                :groupValue="groupValue"
                                :isSubTask="false"
                            />
                        </div>
                    </template>
                </Draggable>
            </div>

            <!-- Drop Area -->
            <div class="column-drop-area" :class="{ 'highlight-drop': hoveredColumnIndex === columnIndex }"></div>
        </div>
    </div>
</template>

<script setup>
import { ref, defineProps, nextTick, inject, watch, onMounted, computed } from 'vue'
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

const selection = useTaskSelection();
const { setActiveView, setActiveProject } = selection;
setActiveView('kanban');
watch(() => projectData.value?._id, (newId) => {
    if (newId) setActiveProject(String(newId));
}, { immediate: true });

// Computed properties
const isDisabled = computed(() => {
    const shouldDisableOnWidth = clientWidth.value <= 768;
    const shouldDisableOnPermission = (checkPermission('task.task_list', projectData.value?.isGlobalPermission) !== true || checkPermission('task.task_status', projectData.value?.isGlobalPermission) !== true);
    const shouldDisableOnArchive = (showArchiveVar.value !== false);
    // Disable drag when multi-select is active (>=2 selected). Multi-move
    // happens via the BulkActionBar's "Move" action — keeps the drag
    // behavior unambiguous for the user.
    const shouldDisableOnMultiSelect = selection.count.value >= 2;
    const finalDisabled = shouldDisableOnWidth || shouldDisableOnPermission || shouldDisableOnArchive || shouldDisableOnMultiSelect;
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
    columns.value = Array.isArray(value) ? value : [];
    init();
}, { deep: true })

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

function columnItemKey(row) {
    return (row && (row._id || row.id || row.TaskKey)) || '';
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
</script>
<style src="./new-style.css" scoped />