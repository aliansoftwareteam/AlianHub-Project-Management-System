<!-- RowComponent.vue -->
<template>
    <div class="option-container">
        <div class="field-row d-flex mb-20px" :class="[{'align-items-baseline':rowIndexs?.includes(fieldValue?.id),'align-items-center':isedit || !rowIndexs?.includes(fieldValue?.id)}]">
            <div class="drag-icon cursor-all-scroll position-re">
                <img :src="dragIcon" alt="drag" />
            </div>
            <div>
                <div class="mr-10px ml-10px justify-content-center align-items-center d-flex border-radius-5-px border-gray" v-if="!rowIndexs?.includes(fieldValue?.id) && isedit" :style="[{backgroundColor:fieldValue.color,height: '20px',width: '20px'}]"></div>
                <div v-else class="color-box mr-10px ml-10px justify-content-center align-items-center d-flex border-radius-5-px border-gray">
                    <CustomFieldInputComponent
                        :type="'color'"
                        :placeholder="''"
                        :validations="''"
                        :bindValue="fieldValue.color"
                        :validationVisibility="'blur'"
                        :className="'custom__field-required color-field'"
                        :name="fieldName.color"
                        @inputUpdate="(val) => fieldValue.color = val"
                    />
                </div>
            </div>
            <div class="mr-10px" :class="[{'textboxedit':!rowIndexs?.includes(fieldValue?.id) && isedit,'textbox':!isedit,'textboxedits':rowIndexs?.includes(fieldValue?.id) && isedit}]">
                <span v-if="!rowIndexs?.includes(fieldValue?.id) && isedit" class="d-block custom__field-required option-field text-ellipsis">{{fieldValue.label}}</span>
                <div v-else>
                    <CustomFieldInputComponent
                        :type="'text'"
                        :placeholder="$t('PlaceHolder.Enter_option')"
                        :validations="'required:trim'"
                        :bindValue="fieldValue.label"
                        :validationVisibility="'blur'"
                        :className="'custom__field-required option-field'"
                        :name="fieldName.option"
                        @inputUpdate="(val) => fieldValue.label = val"
                        :customValidationMessage="fieldValue.label === '' ? { required: $t('generalErrorMessage.field_required') } : {}"
                        :id="`focus${fieldValue?.id}`"
                    />
                </div>
            </div>
            <div class="cursor-pointer d-flex" v-if="!isedit">
                <img v-show="isDeletable" :src="deleteIcon" alt="Delete" @click="emit('deleteIndex', rowIndex)" />
            </div>
            <div class="cursor-pointer d-flex" v-else>
                <img class="pr-10px" v-if="!rowIndexs?.includes(fieldValue?.id)" :src="editIcon" alt="Edit" @click="handleCheck(fieldValue.id,fieldValue.label)"  />
                <img class="" v-show="isDeletable" v-if="!rowIndexs?.includes(fieldValue?.id)" :src="deleteIcon" alt="Delete" @click="emit('deleteIndex', rowIndex)" />
                <img class="pr-10px" v-if="rowIndexs?.includes(fieldValue?.id)" :src="saveImage" alt="save" @click="emit('editIndex',false,fieldValue.id,fieldValue.label)"  />
                <img class="" v-if="rowIndexs?.includes(fieldValue?.id)" :src="deleteImage" alt="Delete" @click="emit('editIndex',null,fieldValue.id,fieldValue.label)" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, defineProps, watch } from "vue";
import CustomFieldInputComponent from "../../../customFieldSidebar/customFieldSidebarComponent/customFieldInputComponent/customFieldInputComponent.vue";

// props
const props = defineProps({
    data: {
        type: Object,
        default: () => {}
    },
    rowIndex: {
        type: Number,
        default: 0
    },
    fieldName: {
        type: Object,
        default: () => {}
    },
    isDeletable: {
        type: Boolean,
        default: true
    },
    isedit: {
        type: Boolean
    },
    rowIndexs: {
        type: [Array]
    }
});

// Variables
const fieldValue = ref(props.data);
const isDeletable = ref(props.isDeletable);
const deleteIcon = require("@/assets/images/svg/Delete_gray.svg");
const dragIcon = require("@/assets/images/svg/drag_icon.svg");
const editIcon = require("@/assets/images/svg/edit_icon.svg");
const deleteImage = require('@/assets/images/delete1.png');
const saveImage = require('@/assets/images/save.png');

watch(() => props.isDeletable, (val) => {
    isDeletable.value = val;
});
const emit =defineEmits(['editIndex','deleteIndex'])
const handleCheck = (id,val) => {
    emit('editIndex',true,id,val)
    setTimeout(()=>{
        const focusCheck = document.getElementById(`focus${id}`).focus();
        if(focusCheck){
            focusCheck.focus();
        }
    })
}
</script>