<template>
    <button @click="isCustomField = true" class="btn-primary font-size-16 font-ui">+ {{$t('CustomField.add_custom_field')}}</button>
    <div class="d-flex mt-15px style-scroll w-100">
        <div v-if="customFieldVal.length > 0" class="w-100">
            <div class="createProject__table-header style-scroll overflow-auto">
                <table>
                    <thead class="text-center overflow-hidden position-sti">
                        <tr>
                            <th class="p-1 text-left">{{$t('CustomField.lable')}}</th>
                            <th class="p-1 text-left">{{$t('Description.description')}}</th>
                            <th class="p-1 text-left">{{$t('CustomField.action')}}</th>
                        </tr>
                    </thead>
                    <tbody class="createProject__table-body">
                        <tr class="p-2" v-for="(item, index) in customFieldVal" :key="index">
                            <td class="p-1">
                                <div class="d-flex align-items-center createProject__custom-field-icon-title">
                                    <img
                                        :src="getImageData(item.fieldImage)"
                                        alt="closeButton"
                                    />
                                    <span class="text-ellipsis createProject__table-body-content d-inline-block" :title="item.fieldTitle">{{ item.fieldTitle }}</span>
                                </div>
                            </td>
                            <td class="p-1"><span class="text-ellipsis createProject__table-body-content d-inline-block" :title="item.fieldDescription">{{ item.fieldDescription }}</span></td>
                            <td class="p-1">
                                <img
                                :src="deleteBlueImage"
                                alt="closeButton"
                                class="cursor-pointer"
                                @click="deleteCustomVal(index)"
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    <CustomFieldsSidebarComponent
        @customFieldStore="customFieldStore"
        @closeSidebar="handleCloseSidebar"
        :componentDetail="{}"
        :customFieldObject="{}"
        :isCustomField="isCustomField"
        @handleClose="handleClose()"
    />
</template>
<script setup>
import {ref,defineEmits,defineProps, onMounted,inject} from 'vue'
import useCustomFieldImage from '@/composable/customFieldIcon.js';
const { getImageData } = useCustomFieldImage();

const emit = defineEmits(['manageCustomField'])

const deleteBlueImage = require("@/assets/images/delete.png");
const isCustomField = ref(false);
const customFieldVal = ref([]);
const props = defineProps({
    customField:{
        default: () => [],
        type:Array
    }
});
// inject
const userId = inject('$userId');
onMounted(()=>{
    if(props.customField.length) {
        customFieldVal.value = JSON.parse(JSON.stringify(props.customField));
    }
})

const customFieldStore = (object) => {
    let value = JSON.parse(JSON.stringify(object));
    value.userId = userId.value;
    customFieldVal.value.push(value);
    emit('manageCustomField', customFieldVal.value);
    isCustomField.value = false;
};
const deleteCustomVal = (index) => {
    customFieldVal.value.splice(index, 1)
    emit('manageCustomField', customFieldVal.value);
}
const handleCloseSidebar = (val,pageIndex) => {
    if(pageIndex === 0) isCustomField.value = val;
};
const handleClose = () => {
    isCustomField.value = false;
};
</script>
<style src="./style.css"></style>