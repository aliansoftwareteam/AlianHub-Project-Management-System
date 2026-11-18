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
                    <img :src="aiIcon" class="ml-8px" />
                    <label class="ai-sub-check-list-font-weight-normal ai-sub-check-list-font-size-15 ml-10-px checklist__label-main text-ellipsis" :class="[{'w-90': item.name.length > 200}]">
                        <span class="label-item-name text-ellipsis ai-sub-check-list-font-size-14 d-block" :title="item.name">{{ item.name }}</span>
                    </label>
                </div>
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
import {defineProps, defineEmits, inject} from "vue";

// Components
import SubCheckList from "./AiSubCheckList.vue";

// Emites
const emits = defineEmits(["check", "add", "remove", "edit", "exapandCollepse", "assigneeEmit", "update", "showInput", "hideInput"])
const clientWidth = inject("$clientWidth");
const aiIcon = require("@/assets/images/svg/ai_image.svg");
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
</script>
<style> @import "./style.css"; </style>

<style scoped>
.ai-sub-check-list-font-weight-normal {
    font-weight: normal;
}
.ai-sub-check-list-font-size-15 {
    font-size: 15px;
}
.ai-sub-check-list-font-size-14 {
    font-size: 14px;
}
</style>
