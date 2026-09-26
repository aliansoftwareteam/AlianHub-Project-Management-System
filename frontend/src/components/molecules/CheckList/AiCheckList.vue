<!--
    Filename: Checklist.vue
    Assignee: Parth Detroja [30-05-2023]
-->
<template>
    <div class="checklist-main mobile__bg--withPadding">
        <div class="tree_main">
            <ul class="main_ul" v-if="newList && newList.length > 0">
                <li class="parent-list-item" :id="'list_'+row.id" v-for="(row, index) in newList" :key="index">
                    <div class="sticky_item-wrapper">
                        <div class="d-flex justify-content-between parent-item">
                            <div class="d-flex align-items-center w-85">
                                <img src="@/assets/images/table_arrow.png" alt="" v-if="row?.subItems && row.subItems.length" class="align-items-center cursor-pointer mr-10-px" :style="`transform: rotateZ(${row.isExpand ? '90' : '0'}deg); margin-left:2px;`" @click="handleCollapseExpand(row)"/>
                                <input type="checkbox" :id="'checkbox_sub_'+row.id" @click="handleCheckedParent(row.isChecked)" v-model="row.isChecked"/>
                                <img :src="aiIcon" class="ml-8px" />
                                <label class="font-weight-normal font-size-14 d-flex ml-10-px black" :class="[{'w-90': row.name.length > 100}]">
                                    <span class="text-ellipsis font-size-14 font-weight-500 black" :title="row.name">{{ row.name }}</span>
                                </label>
                                <!-- <div class="d-flex ml-10-px">
                                    <span class="d-flex align-items-center font-size-13 font-weight-400 GunPowder">({{ row.checkItem }}/{{ row.totalSubItems }})</span>
                                </div> -->
                            </div>
                        </div>
                    </div>
                    <SubCheckList v-if="row.isExpand && row.subItems && row.subItems.length" 
                        :data="row.subItems"
                        :task="!taskId.length ? project : task"
                        :rowId="rowId"
                        @check="handleChecked" 
                        @exapandCollepse="handleCollapseExpand"
                        @showInput="showInput"
                        @hideInput="rowId=''"
                        :from="!taskId.length ? 'project' : 'task'"
                    />
                    <div class="pt-15px d-flex justify-content-end">
                        <button class="outline-primary mr-10-px font-size-16 font-weight-400" @click="cancelChecklist()" v-if="row.isAigenerated">{{$t('Projects.cancel')}}</button>
                        <button class="btn-primary mr-10-px font-size-16 font-weight-400" @click="saveChecklist()" v-if="checklistArray.filter((x) => x.isChecked === true).length > 0">{{`${$t('general.Create')} ${checklistArray.filter((x) => x.isChecked === true).length} ${$t('Checklist.checklist')}`}}</button>
                    </div>
                </li>
            </ul>
        </div>
        <SpinnerComp :is-spinner="checkSpinner" v-if="checkSpinner" />
        <span v-if="isErrorFromAI" class="red">{{$t('Toast.something_went_wrong')}}</span>
    </div>
</template>

<script setup>
// Imports files and components
import { inject, ref, onMounted, watch, defineProps, computed } from 'vue';

// Components
import SubCheckList from './AiSubCheckList.vue';
import { useCustomComposable } from '@/composable';
import { useToast } from 'vue-toast-notification';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp';
import { useI18n } from "vue-i18n";
import taskClass from "@/utils/TaskOperations";
import {useGetterFunctions } from '@/composable';
import { useStore } from 'vuex';
const { t } = useI18n();

// UTILS
const {makeUniqueId} = useCustomComposable();
const $toast = useToast();
const aiIcon = require("@/assets/images/svg/ai_image.svg");
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
    isSpinnerAi: {
        type: Boolean,
        default: false
    },
    isError: {
        type: Boolean,
        default: false
    }
})

// Variables
const project = inject("selectedProject");
const checklistArray = ref([]);
const newList = ref([]);
let rowId = ref('');
let checklsitType = ref("");
const isErrorFromAI = ref(false);
const userId = inject('$userId');
const companyId = inject('$companyId');
const emit =  defineEmits(["cancleCheck","updateChecklist"]);
const { getUser } = useGetterFunctions();
const { getters } = useStore();

// Mounted event
onMounted(() => {
    initialize();
})

const checkSpinner = ref(false);
watch(() => props.isSpinnerAi,(newVal) => {
    checkSpinner.value = newVal;
})

watch(() => props.isError,(newVal) => {
    isErrorFromAI.value = newVal;
})
const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
});

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

// Watch Property
watch(() => props.data, (newVal, oldVal) => {
    if(JSON.stringify(newVal) === JSON.stringify(oldVal)) {
        return
    }
    var tempArray = [];
    if(newVal.length > 0){
        newVal.map(item => {
            if(checklistArray.value.length > 0 && checklistArray.value.map(itm=>itm.id).includes(item.id)){
                var OldItems = checklistArray.value.find(itm => itm.id == item.id)
                tempArray.push({...item,isExpand: OldItems.isExpand})
            }else{
                tempArray.push({...item,isExpand: false})  
            }
        })
    }
    checklistArray.value = tempArray
    manageCheckList()
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

// This function is used to manage all the expand and collepse event for the parent and sub checklist component
function handleCollapseExpand (obj) {
    obj.isExpand = !obj.isExpand;
    checklistArray.value.forEach((x) => {
        if(x.id === obj.id) {
            x.isExpand = !x.isExpand;
        }
    });
}


// This function is used for the toggle the checked state of an parent item
const handleChecked = (item) => {
    item.isChecked = !item.isChecked;
    const index = checklistArray.value.map(e => e.id).indexOf(item.id);
    if(index !== -1) {
        checklistArray.value[index].isChecked = item.isChecked;
    }
    // Update the checked state of all child items recursively
    updateChildItems(item);
    updateParentItems(item);
};

function handleCheckedParent (checkValue) {
    checklistArray.value.forEach((check) => {
        check.isChecked = !checkValue;
    })
    manageCheckList();
}

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
        const mainParent = checklistArray.value.findIndex((x) => !x.parentId);
        if(parentIndex !== -1) {
            const parentItem = checklistArray.value[parentIndex];
            if(parentItem) {
                checklistArray.value[parentIndex].isChecked = true;
                updateParentItems(parentItem);
                manageCheckList();
            }
        }
        if(mainParent !== -1) {
           const mainparentItem = checklistArray.value[mainParent];
           if(mainparentItem){
                checklistArray.value[mainParent].isChecked = true;
                manageCheckList();
           }
        }
    }
};

// Manage add item input box
const showInput = (obj) => {
    rowId.value = obj.id;
    obj.isExpand = true;
    checklistArray.value.forEach((x) => {
        if(x.id === obj.id) { x.isExpand = true; }
    });
}

function saveChecklist() {
    let finalData = checklistArray.value.filter((x) => x.isChecked === true);
    if(finalData.length > 0){
        cancelChecklist();
        const idMap = {}
        finalData.forEach(item => {
            idMap[item.id] = makeUniqueId(6);
        });
        finalData = finalData.map(item => {
            const newItem = { id: idMap[item.id], name: item.name, isChecked:false,isExpand:false };
            if (item.parentId) {
                if(idMap[item.parentId]){
                    newItem.parentId = idMap[item.parentId];
                }else{
                    delete newItem.parentId;
                }
            }
            return newItem;
        });
        const user = getUser(userId.value);
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner.value.id,
        }
        taskClass.updateAiChecklist({companyId: companyId.value, taskId: props.task._id,checklistArray:finalData, userData:userData,sprintId:props.task.sprintId, projectId: props.task.ProjectID})
        .then(() => {
            $toast.success(t("Toast.checklist_created_successfully"), {position: 'top-right'});
        })
    }else{
        $toast.error(t(`Toast.Please_select_checklist`), {position:"top-right"});
    }
}

function cancelChecklist () {
    checklistArray.value = checklistArray.value.filter((x) => !x.isAigenerated);
    manageCheckList();
    emit('cancleCheck')
}
</script>
<style> @import "./style.css"; </style>