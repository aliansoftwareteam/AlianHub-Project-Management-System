<!--
    Filename: Checklist.vue
    Assignee: Parth Detroja [30-05-2023]
-->
<template>
    <div class="pt-20px">
        <div class="checklist-main mobile__bg--withPadding">
            <div class="d-flex align-items-center">
                <h4 :class="{'font-size-16 font-weight-600' : clientWidth <=767 , 'font-size-14 font-weight-700' : clientWidth > 767 }" class="black">{{$t('Checklist.checklist')}}</h4>
                <div class="d-flex align-items-center ml-auto" @click="generateChecklistWithAi()" v-if="checkApps('AI',project) && checkPermission('task.task_checklist',project?.isGlobalPermission) === true">
                    <img :src="aiIcon" class="mr-3px" />
                    <h5 class="cursor-pointer ai-color ai-border-bottom font-size-14 font-weight-500" :class="[{'pointer-event-none' : isSpinnerAi}]">{{$t('Checklist.suggest_checklists')}}</h5>
                </div>
            </div>
            <div v-if="props.isMainSpinner">
                <template v-for="index in 4" :key="`skeleton-${index}`">
                    <Skelatons style="height: 37px;" class="border-radius-6-px mb-5px"/>
                </template>
            </div>
            <div v-else>
                <div class="tree_main">
                    <ul class="main_ul" v-if="newList && newList.length > 0">
                        <li class="parent-list-item" :id="'list_'+row.id" v-for="(row, index) in newList" :key="index">
                            <div class="sticky_item-wrapper">
                                <div class="d-flex justify-content-between parent-item">
                                    <div class="d-flex align-items-center w-85">
                                        <img src="@/assets/images/table_arrow.png" alt="" v-if="row?.subItems && row.subItems.length" class="align-items-center cursor-pointer" :style="`transform: rotateZ(${row.isExpand ? '90' : '0'}deg); margin-left:2px;`" @click="handleCollapseExpand(row)"/>
                                        <label class="font-weight-normal font-size-14 d-flex ml-10-px black" :class="[{'w-90': row.name.length > 100}]">
                                            <InputText v-if="row.isEdit"
                                                v-model.trim="oldItemName"
                                                :placeHolder="$t('PlaceHolder.Enter_item_name')"
                                                @enter="handleUpdate(row, false)"
                                                @blur="row.isEdit=false"
                                                :isDirectFocus="true"
                                                class="input-edit-checklist"
                                                :class="[{'border-bottom-red': isInvalid}]"
                                            />
                                            <span v-else class="text-ellipsis font-size-14 font-weight-500 black" :title="row.name">{{ row.name }}</span>
                                        </label>
                                        <div class="d-flex ml-10-px">
                                            <span class="d-flex align-items-center font-size-13 font-weight-400 GunPowder">({{ row.checkItem }}/{{ row.totalSubItems }})</span>
                                        </div>
                                        <div class="d-flex align-items-center">
                                            <img v-if="permission === true" class="ml-10-px mr-4-px cursor-pointer action-img-border" src="@/assets/images/svg/pluss.svg" alt="Add" @click="showInput(row)" />
                                            <img v-if="!row.isEdit && permission === true" :src="editing" class="cursor-pointer action-img-border mr-10-px" alt="editing"  @click="handleEdit(row)" />
                                        </div>
                                    </div>
                                    <div class="d-flex align-items-center" :class="{'w-15 justify-content-end text-right' : clientWidth <=767 }" v-if="permission === true">
                                        <span class="action-section">
                                            <img :src="clientWidth > 767 ? deleteIconDeskTop: deleteIconMobile" class="cursor-pointer" alt="Delete"  @click="handleDelete(row)" />
                                        </span>
                                    </div>
                                </div>
                                <div class="progress" v-if="!row.isAigenerated">
                                    <div class="bar" :style="
                                        `width: ${row.totalSubItems === row.checkItem && (row.totalSubItems !== 0 && row.checkItem !== 0) ? `100%`: `${row.checkItem / row.totalSubItems * 100}%`}; 
                                        background-color: ${row.totalSubItems === row.checkItem && (row.totalSubItems !== 0 && row.checkItem !== 0) ? '#1CB303': `${row.totalSubItems === 0 && row.checkItem === 0 || row.checkItem / row.totalSubItems * 100 === 0 ? '' : '#2F3990'}`}`">
                                    </div>
                                </div>
                            </div>
                            <div class="input-section d-flex" v-if="row.id === rowId">
                                <InputTextarea
                                    v-model.trim="inputModelValue"
                                    :placeHolder="$t('PlaceHolder.Add_an_item')"
                                    @enter="addItem({name: inputModelValue, parentId: row.id})"
                                    name="parentItem"
                                    :isDirectFocus="true"
                                    :class="[{'border-bottom-red': isInvalid}]"
                                    :maxlength="30000"
                                />
                                <img class="cursor-pointer w-14" :src="clientWidth > 767 ? crossIconDesktop:crossIconMobile" alt="close" @click="rowId=''"/>
                            </div>
                            <SubCheckList v-if="row.isExpand && row.subItems && row.subItems.length" 
                                :data="row.subItems"
                                :task="!taskId.length ? project : task"
                                :rowId="rowId"
                                @check="handleChecked" 
                                @add="addItem($event, true)" 
                                @remove="handleDelete" 
                                @edit="handleEdit"
                                @exapandCollepse="handleCollapseExpand"
                                @assigneeEmit="subItemAssignee"
                                @update="handleUpdate($event, true)"
                                @showInput="showInput"
                                @hideInput="rowId=''"
                                :from="!taskId.length ? 'project' : 'task'"
                            />
                        </li>
                        <ConfirmModal
                            :modelValue="showConfirmModal"
                            :acceptButtonText="$t('Home.Confirm')"
                            :cancelButtonText="$t('Projects.cancel')"
                            :header="true"
                            :showCloseIcon="false"
                            @accept="handleConfirm"
                            @close="showConfirmModal = false"
                        >
                            <template #header>
                                <h3 class="m-0">{{$t('Home.Confirm')}}</h3>
                            </template>
                            <template #body>
                                <span>{{$t('Filters.are_you_suredelete')}}?</span>
                            </template>
                        </ConfirmModal>
                    </ul>
                    <AiCheckList 
                        v-if="checkPermission('task.task_checklist',project?.isGlobalPermission) !== null && checkListAi.length"
                        :taskId="task._id"
                        :sprintId="task.sprintId"
                        :data="checkListAi"
                        :task="task"
                        :permission="checkPermission('task.task_checklist',project?.isGlobalPermission) === true"
                        :isSpinnerAi="isSpinnerAi"
                        @cancleCheck="checkListAi = []"
                        @updateChecklist="updateChecklist($event)"
                    />
                </div>
                <div v-if="permission === true" class="new-checklist-section" @click="addCheckList">
                    <span class="d-flex"><i class="mr-8px font-size-18 font-normal">+</i>{{$t('Checklist.add_checklist')}}</span>
                </div>
                <div v-if="isSpinnerAi">
                    <Skelaton v-for="i in 4" :key="i" class="border-radius-5-px m-5px border-bottom px-1 subtask__item-input"/>
                </div>
                <span v-if="isError" class="red">{{$t('generalErrorMessage.something_went_wrong')}}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
// Imports files and components
import { inject, ref, onMounted, watch, defineProps, computed } from 'vue';
import { useStore } from 'vuex';

// Components
import SubCheckList from './SubCheckList.vue';
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import InputTextarea from '@/components/atom/InputTextarea/InputTextarea.vue';
import InputText from '@/components/atom/InputText/InputText.vue';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import * as env from '@/config/env';
import { apiRequest } from '../../../services';
import { useToast } from 'vue-toast-notification';
import AiCheckList from './AiCheckList.vue';
import { useAiApiFunction } from "@/composable/aiHelper";
import Skelaton from "@/components/atom/Skelaton/AiSkelaton.vue";
import Skelatons from '@/components/atom/Skelaton/Skelaton.vue';
import { useI18n } from "vue-i18n";
const { t } = useI18n();
import taskClass from "@/utils/TaskOperations";

// UTILS
const {makeUniqueId, checkPermission,checkApps,debouncerWithPromise} = useCustomComposable();
const { getUser } = useGetterFunctions();
const { getters } = useStore();
const $toast = useToast();
const {generateAiRequestForFunction} = useAiApiFunction();
const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
});

// IMAGES
const editing = require("@/assets/images/editing.png");
const deleteIconDeskTop = require("@/assets/images/svg/delete_svg.svg");
const deleteIconMobile = require("@/assets/images/svg/deleteCheckListMobile.svg");
const crossIconDesktop = require("@/assets/images/svg/cross.svg");
const crossIconMobile = require("@/assets/images/svg/checkList_mobile_cross.svg");

// Props
const props = defineProps({
    taskId: {
        type: String,
        default: ""
    },
    sprintId: {
        type: String,
        default: ""
    },
    data: {
        type: Array,
        default: () => []
    },
    task: {
        type: Object,
        default: () => {}
    },
    permission: {
        type: Boolean,
        default: false
    },
    planCondition:{
        type: Boolean,
        default: false
    },
    isMainSpinner: {
        type: Boolean,
        default: false
    }
})

// Variables
const clientWidth = inject("$clientWidth");
const userId = inject('$userId');
const companyId = inject('$companyId');
const project = inject("selectedProject");
const checklistArray = ref([]);
const newList = ref([]);
let showConfirmModal = ref(false);
let rowId = ref('');
let selectedRow = ref({});
let inputModelValue = ref('');
let isInvalid = ref(false);
let oldItemName = ref("");
let checklsitType = ref("");
const isError = ref(false)
const checkListAi = ref([]);
const isSpinnerAi = ref(false);
// Get user details
function getUserData() {
    const user = getUser(userId.value);
    return {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: companyOwner.value.id,
    };
}
const userData = getUserData();
const aiIcon = require("@/assets/images/svg/ai_image.svg");

// Mounted event
onMounted(() => {
    if(!props.isMainSpinner){
        initialize();
    }
})

function initialize() {
    if(!props.taskId.length) {
        checklsitType.value = "project";
    } else {
        checklsitType.value = "task";
    }

    checklistArray.value = props.data || [];
    manageCheckList()
}

watch(project, (newVal, oldVal) => {
    if(newVal._id !== oldVal._id) {
        initialize()
    }
})

watch(() => props.isMainSpinner, (newVal) => {
    if(newVal === false) {
        initialize();
    }
})


// Watch Property
watch(() => props.data, (newVal, oldVal) => {
    if(JSON.stringify(newVal) === JSON.stringify(oldVal)) {
        return
    }
    var tempArray = [];
    let newItem = {};
    if(newVal.length > 0){
        newVal.map(item => {
            if(checklistArray.value.length > 0 && checklistArray.value.map(itm=>itm.id).includes(item.id)){
                var OldItems = checklistArray.value.find(itm => itm.id == item.id)
                tempArray.push({...item,isExpand: OldItems.isExpand})
            }else{
                tempArray.push({...item,isExpand: false})  
                newItem = item
            }
        })
    }
    checklistArray.value = tempArray
    manageCheckList();
    let find = checklistArray.value.find((x) => x.id === newItem.parentId);
    if(find && find.isChecked === true && newItem){
        newItem.isChecked = true
        handleChecked(newItem);
    }
});

// This is the recursive function for rendering checklist items. This is used to manage listing array based on parent and child items
function manageCheckList () {
    newList.value = [];
    if(checklistArray.value.length > 0 ) {
        var levels = {}
        var result = checklistArray.value.map(o => ({
            ...o,
            level: levels[o.id] = o.parentId in levels ? levels[o.parentId] + 1 : 0
        }));
        var tree = function (data, root) {
            var t = {};
            data.forEach(o => {
                var item = { ...o, checkItemProgress: 0, isAllSelected: '', checkItem: 0, totalSubItems: 0, isEdit: false }
                Object.assign(t[item.id] = t[item.id] || {}, item);
                t[item.parentId] = t[item.parentId] || {};
                t[item.parentId].subItems = t[item.parentId].subItems || [];
                t[item.parentId].subItems.push(t[item.id]);
            });
            return t[root].subItems;
        }(result, undefined);
        newList.value = tree
    }
    if(newList.value && newList.value.length > 0) {
        const madeNestedArray = (items, array) => {
            array.forEach((data) => {
                items.totalSubItems++;
                if(data.isChecked) {
                    items.checkItem++;
                }
                if (data.subItems && data.subItems.length > 0) {
                    madeNestedArray(items, data.subItems);
                }
            })
        }
        newList.value.forEach(items => {
            if(items && !items.parentId && items.subItems && items.subItems.length > 0) {
                madeNestedArray(items,items.subItems)
            }
        })
    }
}

// This function is used to manage all the checklist hostory for the project and tasks
const manageHistory = async (type, key, message) => {
    const axiosData = {
        "type": type,
        "companyId": companyId.value,
        "projectId": project.value._id,
        "taskId": props.taskId || null,
        "object": {
            "sprintId": props.taskId.length ? props.task.sprintId : null,
            "key": key,
            "message": message
        },
        "userData": getUserData()
    };
    await apiRequest("post", env.HANDLE_HISTORY, axiosData).then((result) => {
        if(result.data.status) {
            console.info(result.data.statusText)
        }
    });
}

// This function is used to manage all the expand and collepse event for the parent and sub checklist component
function handleCollapseExpand (obj) {
    obj.isExpand = !obj.isExpand;
    checklistArray.value.forEach((x) => {
        if(x.id === obj.id) {
            x.isExpand = !x.isExpand;
        }
    });
}

// This function is used for the create new parent checklist
const addCheckList = async () => {
    const uniqueId = makeUniqueId(6);
    let dataArray = {
        AssigneeUserId: [],
        id: uniqueId,
        name: "Checklist",
        isChecked: false,
        isExpand: false
    }
    if(checklsitType.value !== "project") {
        let historyObj = {
            key : "taskchecklistcreate",
            Employee_Name: userData.Employee_Name,
            userId: userData.id,
            taskName: JSON.parse(JSON.stringify(props.task)).TaskName,
            projectName: JSON.parse(JSON.stringify(project.value)).ProjectName,
            value: "Checklist"
        }
        let localUpdateArray = [...new Set([...checklistArray.value || [], ...[dataArray]])];

        taskClass.updateChecklistsv2({localUpdateArray:localUpdateArray,data:dataArray, projectId:project.value._id, taskId:props.taskId,historyObj,sprintId:props.sprintId,companyId:companyId.value,ops:'taskchecklistcreate',taskData: props.task}).catch((error) => {
            console.error("ERROR in delete: ", error.message);
        });
        rowId.value = uniqueId;
        setTimeout(() => {
            checklistArray.value.forEach((x) => {
                if(x.id === uniqueId) {
                    x.isExpand = !x.isExpand;
                }
            });
        }, 200);
        return;
    }

    const params = {
        id: project.value._id,
        checklistItem: dataArray,
        operation: 'push'
    }

    await apiRequest("post", `${env.PROJECTS_CHECKLIST}`, params).then(() => {
        checklistArray.value = [...checklistArray.value, { ...dataArray }];
        manageCheckList();

        // Manage checklist history
        const msg =  `<b>${userData.Employee_Name}</b> has created new checklist`;
        manageHistory(checklsitType.value, "Task_Checklist", msg);
    }).catch((error) => {
        console.error(`Error in addCheckList hook => ${error}`)
    });
}

// This function is used for add new checklist item
const addItem = async (obj, child = false) => {
    if(!child && inputModelValue.value === "") {
        isInvalid.value = true;
        return;
    }
    isInvalid.value = false;
    const strArray = obj.name.split('\n').filter((d)=>d !== '')?.map((e)=>({
        AssigneeUserId: [],
        id: makeUniqueId(6),
        isChecked: false,
        isExpand: false,
        parentId: obj.parentId,
        name: e
    }));
    if(checklsitType.value !== "project") {
        let historyObj = {
            key : "checklistadd",
            Employee_Name: userData.Employee_Name,
            userId: userData.id,
            name: obj.name,
            taskName: JSON.parse(JSON.stringify(props.task)).TaskName,
            projectName: JSON.parse(JSON.stringify(project.value)).ProjectName,
        }
        let localUpdateArray = [...new Set([...checklistArray.value, ...strArray])];

        taskClass.updateChecklistsv2({data:strArray,localUpdateArray, projectId:project.value._id, taskId:props.taskId,historyObj,sprintId:props.sprintId,companyId:companyId.value,ops:'checklistadd',taskData: props.task}).catch((error) => {
            console.error("ERROR in delete: ", error.message);
        });
        checklistArray.value.forEach((x) => {
            if(x.parentId === obj.parentId) {
                x.isExpand = true;
                obj.isExpand = true;
            }
        });
        inputModelValue.value = "";
        return;
    }

    const params = {
        id: project.value._id,
        checklistItem: strArray[0],
        operation: 'push'
    }

    await apiRequest("post", `${env.PROJECTS_CHECKLIST}`, params).then(() => {
        checklistArray.value = [...checklistArray.value, { ...strArray[0] }];
        manageCheckList();

        // Manage checklist history
        const msg = `<b>${userData.Employee_Name}</b> has created new checklist item <b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${obj.name}">${obj.name}</b>`;
        manageHistory(checklsitType.value, "Task_Checklist", msg);
        checklistArray.value.forEach((x) => {
            if(x.parentId === obj.parentId) {
                x.isExpand = true;
                obj.isExpand = true;
            }
        });
        inputModelValue.value = "";
    }).catch((error) => {
        inputModelValue.value = "";
        console.error(`Error in addItem hook => ${error}`)
    });
}

// This function is used to manage delete event for the checklist or checklist item 
const handleDelete = (obj) => {
    showConfirmModal.value = true;
    selectedRow.value = obj;
}
async function handleConfirm(val) {
    if(val) {
    // Delete all the items delete from database
        const getParentIds = (obj, parentId = null) => {
            const result = {};
            if (obj instanceof Array) {
                obj.forEach(item => {
                    const subResult = getParentIds(item, parentId);
                    Object.assign(result, subResult);
                });
            } else if (obj instanceof Object) {
                if (obj.id) {
                    result[obj.id] = parentId;
                    const subResult = getParentIds(obj.subItems, obj.id);
                    Object.assign(result, subResult);
                }
            }
            return result;
        }
        const getIdsAndNames = (item) => {
            const result = { id: item.id, name: item.name };
            if (item.subItems && item.subItems.length > 0) {
                result.subItemNames = item.subItems.map(subItem => subItem.name);
            }
            return result;
        }

        const getIdsAndNamesRec = (item) => {
            const result = getIdsAndNames(item);
            if (item.subItems && item.subItems.length > 0) {
                result.subItems = item.subItems.map(subItem => getIdsAndNamesRec(subItem));
            }
            return result;
        }

        const getSubitemNames = (item, namesArray) => {
            namesArray.push(item.name);
            if (item.subItems && item.subItems.length > 0) {
                item.subItems.forEach(subItem => {
                    getSubitemNames(subItem, namesArray);
                });
            }
        }

        const mergeFunctions = (item) => {
            const result = getIdsAndNamesRec(item);
            const namesArray = [];
            getSubitemNames(item, namesArray);
            result.subItemNames = namesArray;
            return result;
        }
        const deleteQuery = async (obj,extractedData) => {
            if(checklsitType.value !== "project") {
                let historyObj = {
                    key : "checklistremove",
                    Employee_Name: userData.Employee_Name,
                    userId: userData.id,
                    name: obj.name,
                    taskName: JSON.parse(JSON.stringify(props.task)).TaskName,
                    projectName: JSON.parse(JSON.stringify(project.value)).ProjectName,
                    extractedData
                }

                taskClass.updateChecklistsv2({data:obj, projectId:project.value._id, taskId:props.taskId,historyObj,sprintId:props.sprintId,companyId:companyId.value,ops:'checklistremove',taskData: props.task}).catch((error) => {
                    console.error("ERROR in delete: ", error.message);
                });
                return;
            }

            const params = {
                id: project.value._id,
                checklistItem: obj,
                operation: 'delete'
            }

            await apiRequest("post", `${env.PROJECTS_CHECKLIST}`, params).then(() => {
                for (let i = checklistArray.value.length - 1; i >= 0; i--) {
                    if (obj.includes(checklistArray.value[i].id)) {
                        checklistArray.value.splice(i, 1);
                    }
                }
                manageCheckList();
            }).catch((error) => {
                console.error(`Error in addItem hook => ${error}`) 
            });
        }
        const deleteItems = (item) => {
            const parentIds = getParentIds(item);
            const extractedData = mergeFunctions(item);
            deleteQuery(Object.keys(parentIds),extractedData);
            if(checklsitType.value === "project") {
                const msg =  `<b>${userData.Employee_Name}</b> has removed checklist item <b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${extractedData.name}">${extractedData.name}</b> and its subitems <b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${extractedData.subItemNames.slice(1).join('\n')}">${extractedData.subItemNames.slice(1).join('\n')}</b>`;
                manageHistory(checklsitType.value, "Task_Checklist", msg);
            }
            return;
        }
        deleteItems(selectedRow.value);
        showConfirmModal.value = false;
        manageCheckList();
    }
}

// This function is used for the toggle the checked state of an parent item
const handleChecked = async (item) => {
    item.isChecked = !item.isChecked;
    const index = checklistArray.value.map(e => e.id).indexOf(item.id);
    if(index !== -1) {
        checklistArray.value[index].isChecked = item.isChecked;
    }
    // Update the checked state of all child items recursively
    updateChildItems(item);
    updateParentItems(item);
    if(!item.isAigenerated){

        // Update data on database
        let dataArray = JSON.parse(JSON.stringify(checklistArray.value));
        dataArray.map((x) => clearObject(x))
        if(checklsitType.value !== "project") {
            let historyObj = {
                key : "checklistchecked",
                Employee_Name: userData.Employee_Name,
                userId: userData.id,
                'name': item.name,
                'isChecked': item.isChecked
            }

            taskClass.updateChecklistsv2({data:dataArray,localUpdateArray:dataArray, projectId:project.value._id, taskId:props.taskId,historyObj,sprintId:props.sprintId,companyId:companyId.value,ops:'checklistchecked',taskData: props.task}).catch((error) => {
                console.error("ERROR in delete: ", error.message);
            });
            return;
        }

        const params = {
            id: project.value._id,
            checklistItem: dataArray,
            operation: 'update',
            key: 'isChecked'
        }

        await apiRequest("post", `${env.PROJECTS_CHECKLIST}`, params).then(() => {
            manageCheckList();

            // Manage checklist history
            let historyObj = {
                key : "CheckList_Checked",
                message : `<b>${userData.Employee_Name}</b> has <b>${item.isChecked ? 'checked' : 'unchecked'}</b> <b>${item.name}</b> checklist.`
            }
            apiRequest("post", env.HANDLE_HISTORY, {
                "type": checklsitType.value === "project" ? 'project' : 'task',
                "companyId": companyId.value,
                "projectId": project.value._id,
                "taskId": checklsitType.value === 'project' ? null : props.taskId,
                "object": historyObj,
                "userData": userData
            })
        }).catch((error) => {
            console.error(`Error in addItem hook => ${error}`) 
        });
    }
};

// This function is used for the update the checked state of all child items and parent recursively
const updateChildItems = (item) => {
    if (item.subItems && item.subItems.length > 0) {
        item.subItems.forEach((child) => {
            child.isChecked = item.isChecked;
            const index = checklistArray.value.map(e => e.id).indexOf(child.id);
            if(index !== -1) {
                checklistArray.value[index].isChecked = child.isChecked;
            }
            updateChildItems(child);
        });
    }
};
const updateParentItems = (item = null) => {
    if(item && item.parentId) {
        const parentIndex = checklistArray.value.findIndex((x) => x.id === item.parentId);
        if(parentIndex !== -1) {
            const parentItem = checklistArray.value[parentIndex];
            if(parentItem) {
                if(!checklistArray.value.filter((x) => x.parentId === parentItem.id && !x.isChecked).length) {
                    checklistArray.value[parentIndex].isChecked = true;
                } else {
                    checklistArray.value[parentIndex].isChecked = false;
                }
                updateParentItems(parentItem);
                manageCheckList();
            }
        }
    }
};

// This function is manage update event for the user asign or remove into the database
async function changeAssignee(type, {user, data}) {
    let assignee = data.AssigneeUserId;
    if(type === "add") {
        assignee.push(user.id);
    } else if(type === 'remove') {
        const index = assignee.findIndex((x) => x === user.id)
        assignee.splice(index, 1);
    } else if(type === 'replace') {
        assignee = [];
        assignee.push(user.id);
    }

    let dataArray = JSON.parse(JSON.stringify(checklistArray.value));
    let checkList = {};
    dataArray.forEach((x) => {
        if(x.id === data.id) {
            checkList = x;
            x.AssigneeUserId = assignee;
        }
        clearObject(x);
    });
    if(checklsitType.value !== "project") {
        let historyObj = {
            key : type === "add" ? "checklistassignee" : "assigneeremove",
            taskName: JSON.parse(JSON.stringify(props.task)).TaskName,
            projectName: JSON.parse(JSON.stringify(project.value)).ProjectName,
            Employee_Name: userData.Employee_Name,
            assigneeId:user.id,
            label:user.label,
            updateCheckListId: data.id,
            checkList:checkList.name,
            userId: userData.id,
            type
        }

        taskClass.updateChecklistsv2({data:dataArray,localUpdateArray:dataArray, projectId:project.value._id, taskId:props.taskId,historyObj,sprintId:props.sprintId,companyId:companyId.value,ops:(type === "add" ? "checklistassignee" : "assigneeremove"),taskData: props.task}).catch((error) => {
            console.error("ERROR in delete: ", error.message);
        });
        return;
    }

    const params = {
        id: project.value._id,
        checklistItem: { id: data.id, uid: user.id },
        operation: 'update',
        key: type === "add" ? "assigneeAdd" : "assigneeRemove"
    }

    await apiRequest("post", `${env.PROJECTS_CHECKLIST}`, params).then(() => {
        manageCheckList();

        // Manage checklist history
        const msg =  `<b>${userData.Employee_Name}</b> has ${type === 'add' || type === "replace" ? 'added': 'removed'} <b>${user.label}</b> ${type === 'add' ? 'into': 'from'} checklist item <b>${data.name}</b>`;
        const chkType = type === "add" || type === "replace" ? "Task_Checklist_Assign" : "Task_Checklist_Remove";
        manageHistory(checklsitType.value, chkType, msg);
    }).catch((error) => {
        console.error(`Error in addItem hook => ${error}`) 
    });
}

// This function is used for the call emit event for the user asign or remove into the sub checklist item from CubChecklist Component
const subItemAssignee = (val) => {
    changeAssignee(val.type, {user: val.user, data: val.data});
}

// This functions is used for the call edit emit from the SubChecklist component 
const handleEdit = (obj) => {
    obj.isEdit = !obj.isEdit;
    oldItemName.value = obj.name;
}

// This function is used for update checklist or item name
const handleUpdate = async (obj, child = false) => {
    if(!child && oldItemName.value === "") {
        isInvalid.value = true;
        return;
    }

    isInvalid.value = false;
    let name = !child ? oldItemName.value : obj.name;
    let dataArray = JSON.parse(JSON.stringify(checklistArray.value));
    dataArray.forEach((x) => {
        if(x.id === obj.id) {
            x.name = name;
        }
        clearObject(x);
    })
    if(checklsitType.value !== "project") {
        let historyObj = {
            key : "checklistedit",
            previousName: !child ? obj.name : oldItemName.value,
            newName: name,
            taskName: JSON.parse(JSON.stringify(props.task)).TaskName,
            projectName: JSON.parse(JSON.stringify(project.value)).ProjectName,
            Employee_Name: userData.Employee_Name,
            updatedId: obj.id,
            userId: userData.id
        }

        taskClass.updateChecklistsv2({data:dataArray,localUpdateArray:dataArray, projectId:project.value._id, taskId:props.taskId,historyObj,sprintId:props.sprintId,companyId:companyId.value,ops:'checklistedit',taskData: props.task}).catch((error) => {
            console.error("ERROR in delete: ", error.message);
        });
        return;
    }

    const params = {
        id: project.value._id,
        checklistItem: obj,
        operation: 'update',
        key: 'name'
    }

    await apiRequest("post", `${env.PROJECTS_CHECKLIST}`, params).then(() => {
        checklistArray.value = dataArray;
        checklistArray.value.forEach((x) => x.isExpand = true);
        manageCheckList();

        // Manage checklist history
        const msg =  `<b>${userData.Employee_Name}</b> has changed checklist item name from <b>${!child ? obj.name : oldItemName.value}</b> to <b>${name}</b>`;
        manageHistory(checklsitType.value, "Task_Checklist", msg);
    }).catch((error) => {
        console.error(`Error in addItem hook => ${error}`) 
    });
}

// This functions is used for the clear extra key and values from the checklist array object
function clearObject (data) {
    delete data.subItems;
    delete data.checkItem;
    delete data.checkItemProgress;
    delete data.isAllSelected;
    delete data.totalSubItems;
    delete data.level;
    delete data.isEdit;
    data.isExpand = false;
    return data;
}

// Manage add item input box
const showInput = (obj) => {
    rowId.value = obj.id;
    obj.isExpand = true;
    checklistArray.value.forEach((x) => {
        if(x.id === obj.id) { x.isExpand = true; }
    });
}

function generateChecklistWithAi (){
    if(!isSpinnerAi.value){
        debouncerWithPromise(1000).then(() => {
            isSpinnerAi.value = true;
            checkListAi.value = [];
            isError.value = false;
            let data = {
                userId: userId.value,
                uniqueUserId: userId.value,
                companyId: companyId.value
            }
            generateAiRequestForFunction(data,props.task.TaskName,props.task.rawDescription,'Generate a Checklist',true,'single',project.value?.isGlobalPermission).then((result) => {
                if(result.status === true){
                    try {
                        let data = JSON.parse(JSON.stringify(result.statusText.data.statusText)).replace('```json', '').trim();
                        data = data.replace('```', '').trim();
                        data = data.replace(/\n|\r/g, '').trim();
                        data = eval(data);
                        data.forEach((element) => {
                            if (element.parentId === null) {
                                delete element.parentId;
                            }
                        });
                        checkListAi.value = data.map((x) => ({...x,AssigneeUserId:[],isExpand: true,isChecked:true,isAigenerated:true}));
                        isSpinnerAi.value = false;
                    } catch (error) {
                        isSpinnerAi.value = false;
                        console.error(error,"ERROR IN CATCH");
                        isError.value = true;
                    }
                }else{
                    if(result.isReachedLimit){
                        $toast.error(t("Toast.Ai_limit_reached"),{position: 'top-right'});
                    }else if(result.isNotAi){
                        $toast.error(result.statusText,{position: 'top-right'});
                    }
                    isSpinnerAi.value = false;
                }
            }).catch((error) => {
                isSpinnerAi.value = false;
                isError.value = true;
                console.error(error,"ERROR IN GENERAE PROMPTS:");
            })
        })
    }
}

function updateChecklist (array) {
    checklistArray.value = checklistArray.value.concat(array);
    manageCheckList();
}
</script>
<style> @import "./style.css"; </style>