<template>
    <div>
        <draggable v-model="itemData" tag="ul" class="status_ul" @update:modelValue="$emit('update:modelValue',$event)" @change="updateItem(itemData,$event)" :item-key="makeUniqueId(5)" :group="group.name ? group.name : ''" :move="checkMove">
            <template #item="{ element, index }">
                <li class=" d-flex align-items-center justify-content-between position-re">
                    <span class="taskInnerData"  v-if="!element.isEditable">
                        <div class="d-flex align-items-center  position-re">
                            <span class="drag-image-wrapper position-ab">
                                <img :src="dragIcon" class="dragImage position-re" />
                            </span>
                        <template v-if="!element.isEditable && !isChangeColor" >
                            <TaskTypeIcon
                                :taskType="element"
                                @click="$emit('click:uploadImage'),$emit('click:ImageItem',element)"
                                class="ignore-drag project__setting-ignoredrag border-radius-2-px mr-5px cursor-pointer"
                            />
                        </template>
                        <input v-if="!element.isAddNewStatus && element.textColor" :id="`ActiveTaskStatus${index}`" type="color" v-model.trim="element.textColor" @input="element.bgColor = element.textColor+'35',emit('changeColor')" class="ignore-drag border-radius-2-px mr-8px border-0 d-inline-block p-0 cursor-pointer bg-transparent change__colorignore-drag" disabled>
                        {{ element.name }}
                        </div>    
                    </span> 
                    <input v-if="element.isEditable" class="form-control edit-input" type="text" v-model.trim="element.name" @keypress.enter.prevent="$emit('enter:updateFieldValue', element,categoryTytpe),$emit('disbaleButton',false)" @input="$emit('resetTaskTypeErr')"/>
                    <img :src="saveData" class="cursor-pointer"  v-if="element.isEditable" @click="$emit('click:updateFieldValue', element,categoryTytpe),$emit('disbaleButton',false)">
                    <img :src="deletered" class="cursor-pointer ml-10px" v-if="element.isEditable" @click="element.isEditable = false, element.name = taskTypeName,$emit('disbaleButton',false),$emit('resetTaskTypeErr')">
                    <span class="taskInnerData task-dropdown" v-if="props.from === 'task_type' && itemData.length > 1">
                        <DropDown id="" class="status_change_dropdown" :bodyClass="{'taskstatus-dropdown' : true}" v-if="isDeletable && element.default ? false : true">
                            <template #button>
                                <button class="btn-white border cursor-pointer dot-btn">
                                    <img :src="dotcolor">
                                </button>
                            </template>
                            <template #options>
                                <DropDownOption  @click="$emit('input:deleteFieldValue',element,openSidebar)" class="mobile-delete-status">
                                    <img :src="deleteIcon" class="mr-10px"> {{$t("Templates.remove")}}
                                </DropDownOption>
                            </template>
                        </DropDown>
                    </span>
                    <span class="taskInnerData task-dropdown" v-if="!element.isEditable && element.default ? false : true && props.from !== 'task_type'">
                        <DropDown class="status_change_dropdown" :bodyClass="{'taskstatus-dropdown' : true}" v-if="isDeletable && element.default ? false : true">
                            <template #button>
                                <button class="btn-white border cursor-pointer dot-btn">
                                    <img :src="dotcolor">
                                </button>
                            </template>
                            <template #options>
                                <DropDownOption  @click="$emit('input:deleteFieldValue',element,openSidebar)" class="mobile-delete-status">
                                    <img :src="deleteIcon" class="mr-10px"> {{$t("Templates.remove")}}
                                </DropDownOption>
                            </template>
                        </DropDown>
                    </span>
                </li>
            </template>
        </draggable>
    </div>
</template>
<script setup>
import { ref,defineProps, defineEmits, watch, defineComponent,inject } from 'vue';
import draggable from 'vuedraggable';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import { useCustomComposable } from "@/composable";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
const {makeUniqueId} = useCustomComposable();
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    const emit = defineEmits(["onSelect","resetTaskTypeErr","renameUpdate","disbaleButton","DraggableOption","update:modelValue","click:ImageItem","click:uploadImage", "enter:updateFieldValue", "click:updateFieldValue", "input:deleteFieldValue","changeColor"]);
    defineComponent({
        name: "drag-drop-field",
        components: {
            DropDown,
            DropDownOption,
        }
    })
    const props = defineProps({
        modelValue : {
            type: Array
        },
        isChangeColor: {
            type: Boolean
        },
        isDeletable : {
            type: Boolean
        },
        group:{
            type: Object
        },
        categoryTytpe : {
            type : String
        },
        addTaskType:{
            type: Boolean
        },
        isTemplate: {
            type:Boolean
        },
        from:{
            type: String,
            default:''
        },
        useDataArray : {
            type: Array
        },
        projectData:{
            type: Object,
            default: () => ({})
        }
    })
    const taskTypeName = ref('')
    const itemData = ref(props.modelValue);
    const visible = ref(false);
    const clientWidth = inject("$clientWidth");
    const dragIcon = require("@/assets/images/svg/Swip.svg");
    const saveData = require("@/assets/images/svg/right_tick_green.svg");
    const deletered = require("@/assets/images/svg/deletered.svg");
    const dotcolor = require("@/assets/images/svg/three_dot.svg");
    const deleteIcon = require("@/assets/images/svg/redDelete_Icon.svg");


    watch(() => props.modelValue, (newVal, oldVal) => {
        if(newVal !== oldVal) {
            itemData.value = newVal;
        }
    })
    watch([() => props.addTaskType,()=>props.isTemplate],(val)=>{
        if(val[0] === true || val[1] === true){
            itemData.value?.filter((x)=>{
                if(x.isEditable){
                    x.isEditable = false;
                }
            })
        }
    })
    function updateItem(itemData , event) {
        emit("change:DraggableOption",itemData, event, props.categoryTytpe);
    }
    watch(clientWidth, () => {
        if(clientWidth.value < 767) {
            if(visible.value) {
                visible.value = false;
            }
        }
    })

    function checkMove (e) {
       return !(e.draggedContext.element.default);
    }
</script>
<style scoped>
.taskStatusRight ul {
    padding: 0;
    margin: 0;
}
.taskStatusRight h4
{
    margin: 0;
}
.taskStatusRight ul li{
    list-style: none;
    border: 1px solid #DFE1E6;
    border-radius: 3px;
    padding: 0px 11px 0px 23px;
    margin-bottom: 10px;
    cursor: grab !important;
}
.taskStatusRight ul li 
.taskStatusSection {
    margin-top: 2px;
}
.taskStatusRight ul li span {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px !important;
    line-height: 19px !important;
    /* width: 100%; */
}

button.dot-btn {
    padding: 0;
    border: 0;
    display: flex;
    align-items: center;
}
div#expand_subtask .drop-down-menu {
    right: 15px;
}
.status_change_dropdown .drop-down-options.black .justify-content-between {
    justify-content: flex-start;
}
input.form-control.edit-input {
    margin: 1px 8px 1px 0px;
    background-color: #f1f1f1;
    border: 0;
}
.project__setting-ignoredrag{
    width: 15px;
    height: 15px; 
    object-fit: cover;
}
.change__colorignore-drag{
    width: 16px !important;
    height: 16px !important;
}
@media(max-width: 767px){
    input.form-control.edit-input {margin: 0px 8px 0px 0px;}
}
</style>
