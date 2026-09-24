<!--
    Filename: SubChecklist.vue
    Assignee: Parth Detroja [30-05-2023]
-->
<template>
    <ul class="ul-sub-items">
        <li v-for="(item, index) in data" :key="index" :style="{'margin-left' : !item.subItems ? (clientWidth <=767 ? '10px' : '20px') : (clientWidth <=767 ? '10px' : '20px')}">
            <div class="d-flex justify-content-between child-item">
                <div class="d-flex align-items-center w-85">
                    <img src="@/assets/images/table_arrow.png" alt="" class="cursor-pointer mr-10-px" :style="`transform: rotateZ(${item.isExpand ? '90' : '0'}deg); opacity: ${item.level <= 4 && item.subItems && item.subItems.length ? '1' : '0'}`" @click="handleCollapseExpand(item), item.isExpand=!item.isExpand"/>
                    <input type="checkbox" :id="'checkbox_sub_'+item.id" @click="$emit('check', item)" v-model="item.isChecked"/>
                    <label class="font-weight-normal font-size-15 ml-10-px checklist__label-main text-ellipsis" :class="[{'w-90': item.name.length > 200}]">
                        <InputText v-if="item.isEdit"
                            v-model.trim="oldItemName"
                            :placeHolder="$t('PlaceHolder.Add_an_item')"
                            @enter="handleUpdate(item)"
                            @blur="item.isEdit=false"
                            :isDirectFocus="true"
                            class="input-edit-checklist"
                            :class="[{'border-bottom-red': isInvalid}]"
                        />
                        <span v-else class="label-item-name text-ellipsis font-size-14 d-block" :class="{'text-strike': item.isChecked}" :title="item.name">{{ item.name }}</span>
                    </label>
                    <div class="d-flex align-items-center hover-action" v-if="from === 'task' ? checkPermission('task.task_checklist',project?.isGlobalPermission) == true : checkPermission('project.project_checklist',project?.isGlobalPermission) == true">
                        <img v-if="item.level <= 4" class="ml-10-px mr-5-px cursor-pointer action-img-border" src="@/assets/images/svg/pluss.svg" alt="Add" @click="$emit('showInput', item)" />
                        <img v-if="!item.isEdit" class="cursor-pointer action-img-border" :class="{'ml-10-px': item.level > 4}" :src="editing" alt="editing" @click="handleEdit(item)" />
                    </div>
                </div>
                <div class="d-flex align-items-center sub__cheklist-userassignee" :class="{'hover-action': item.AssigneeUserId?.length === 0, 'w-15 justify-content-end text-right' : clientWidth <=767}">
                    <Assignee
                        v-if="from === 'task' ? checkPermission('task.task_checklist_assign_remove',project?.isGlobalPermission) !== null : checkPermission('project.project_checklist_assign_remove',project?.isGlobalPermission) !== null"
                        :users="item.AssigneeUserId"
                        :options="task.AssigneeUserId"
                        :num-of-users="3"
                        @selected="changeAssignee(checkApps('MultipleAssignees',project) ? 'add' : 'replace', {user: $event, data: item})"
                        @removed="changeAssignee('remove', {user: $event, data: item})"
                        imageWidth="26px"
                        :isDisplayTeam="true"
                        :multiSelect="checkApps('MultipleAssignees')"
                        :addUser="from === 'task' ? checkPermission('task.task_checklist_assign_remove',project?.isGlobalPermission) == true : checkPermission('project.project_checklist_assign_remove',project?.isGlobalPermission) == true"
                    />
                    <span class="d-flex align-items-center action-section hover-action" :style="{width : clientWidth<=767 ? '30%' : ''}" :class="{'hover-action': item.AssigneeUserId?.length === 0, 'justify-content-end' : clientWidth <=767}" v-if="from === 'task' ? checkPermission('task.task_checklist',project?.isGlobalPermission) == true : checkPermission('project.project_checklist',project?.isGlobalPermission) == true">
                        <img class="cursor-pointer"  :src="clientWidth > 767 ? deleteIconDeskTop: deleteIconMobile"  alt="Delete"  @click="handleDelete(item)" />
                    </span>
                </div>
            </div>
            <div class="input-section d-flex" v-if="item.id === rowId" @keydown.esc.stop.prevent="$emit('hideInput', '')">
                <InputTextarea
                    v-model.trim="inputModelValue"
                    :placeHolder="$t('PlaceHolder.Add_an_item')"
                    @enter="addItem(item, index)"
                    :isDirectFocus="true"
                    name="parentItem"
                    :class="[{'border-bottom-red': isInvalid}]"
                    class="ml-15px mt-5px pt-3px"
                    :maxlength="30000"
                />
                <img class="cursor-pointer w-14" src="@/assets/images/svg/cross.svg" alt="close" @click="$emit('hideInput', '')"/>
            </div>
            <SubCheckList v-if="item.isExpand && item.subItems && item.subItems.length" 
                :data="item.subItems"
                :task="task"
                :rowId="rowId"
                @check="$emit('check', $event)" 
                @add="$emit('add', $event)" 
                @remove="$emit('remove', $event)" 
                @edit="$emit('edit', $event)"
                @exapandCollepse="$emit('exapandCollepse', $event)"
                @assigneeEmit="$emit('assigneeEmit', $event)"
                @update="$emit('update', $event)"
                @showInput="$emit('showInput', $event)"
                @hideInput="$emit('hideInput', $event)"
                :from="from === 'task' ? 'task' : 'project'"
            />
        </li>
    </ul>
</template>
<script setup>
// Packages
import {ref, defineProps, defineEmits, inject} from "vue";

// Components
import SubCheckList from "./SubCheckList.vue";
import InputTextarea from '@/components/atom/InputTextarea/InputTextarea.vue';
import { useCustomComposable } from '@/composable';
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import InputText from '@/components/atom/InputText/InputText.vue';

// IMAGES
const editing = require("@/assets/images/editing.png");
const deleteIconDeskTop = require("@/assets/images/svg/delete_svg.svg");
const deleteIconMobile = require("@/assets/images/svg/deleteCheckListMobile.svg");

// UTILS
const {makeUniqueId, checkPermission,checkApps} = useCustomComposable();

// Variables
let inputModelValue = ref('');
let isInvalid = ref(false);
let oldItemName = ref("");

// Emites
const emits = defineEmits(["check", "add", "remove", "edit", "exapandCollepse", "assigneeEmit", "update", "showInput", "hideInput"])
const clientWidth = inject("$clientWidth");
const project = inject("selectedProject");
// Props
defineProps({
    data: {
        type: Array,
        required: true
    },
    task: {
        type: Object,
        required: true
    },
    rowId: {
        type: String,
        required: true
    },
    from: {
        type: String,
        required: true
    }
})

// This function is used for the manage collepse or expand emit from SubChecklist(Child) to Checklist(parent) component
const handleCollapseExpand = (obj) => {
    obj.isExpand = !obj.isExpand;
    emits('exapandCollepse', obj);
}

// This function is used for the add new checklist item in the sub check list
const addItem = (obj) => {
    if(inputModelValue.value === "") {
        isInvalid.value = true;
        return;
    }
    emits('add',{
        AssigneeUserId: [],
        id: makeUniqueId(6),
        name: inputModelValue.value,
        isChecked: false,
        isExpand: false,
        parentId: obj.id
    })
    isInvalid.value = false;
    inputModelValue.value = '';
}

// This functions is uased to handle emit event for the edit check list item name
const handleEdit = (obj) => {
    emits('edit', obj)
    oldItemName.value = obj.name;
}

// This function is used to handle update emit event
const handleUpdate = (obj) => {
    if(oldItemName.value === "") {
        isInvalid.value = true;
        return;
    }
    emits('update',{
        id: obj.id,
        name: oldItemName.value,
    })
    isInvalid.value = false;
}

// This function is used to handle delete emit event for the check list item
const handleDelete = (obj) => {
    emits('remove', obj)
}

// This emit event is used to handle user assign or remove into the sub checklist item
function changeAssignee(type, {user, data}) {
    emits('assigneeEmit', { type: type, user: user, data: data });
}
</script>
<style> @import "./style.css"; </style>