<template>
    <Sidebar
        width="374px"
        :defaultLayout="false"
        :visible="isCustomFields"
        :zIndex="8"
        :className="'customFieldSidebar'"
    >
        <template #head-left>
            <span class="font-weight-bold font-size-18">{{ customFieldObjects?._id ? $t('CustomField.edit_custom_field') : $t('CustomField.create_custom_field') }}</span>
        </template>
        <template #head-right>
            <img :src="closeBlueImage" alt="closeButton" class="cursor-pointer" @click="handleClose()"/>
        </template>
        <template #body>
            <CustomFieldSidebarComponent
                @customFieldStore="customFieldStores"
                @closeSidebar="handleCloseSidebar"
                :componentDetails="componentDetails && Object.keys(componentDetails).length ? componentDetails : {}"
                :pageInd="componentDetails && Object.keys(componentDetails).length ? 1 : 0"
                :customFieldObject="componentDetails && Object.keys(componentDetails).length ? customFieldObjects : {}"
                :isType="isType"
            />
        </template>
    </Sidebar>
</template>
<script setup>
    import { ref, watch } from 'vue';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';

    //image
    const closeBlueImage = require("@/assets/images/svg/CloseSidebar.svg");
    // emit
    const emit = defineEmits(['customFieldStore','closeSidebar','handleClose']);

    const props = defineProps({
        componentDetail:{
            type:Object,
            default:() => {}
        },
        isCustomField:{
            type:Boolean,
            default:false
        },
        customFieldObject:{
            type:Object,
            default:() => {}
        },
        isType:{
            type:Boolean,
            default:false
        }
    });

    //ref
    const componentDetails = ref(props.componentDetail);
    const isCustomFields = ref(props.isCustomField);
    const customFieldObjects = ref(props.customFieldObject);

    watch(() => props.isCustomField, (newVal) => {
        isCustomFields.value = newVal;
    });
    watch(() => props.componentDetail, (newVal) => {
        componentDetails.value = newVal;
    });
    watch(() => props.customFieldObject, (newVal) => {
        customFieldObjects.value = newVal;
    });
    const customFieldStores = (val,isEdit) => {
        emit('customFieldStore',val,isEdit);
    };
    const handleCloseSidebar = (val,pageIndex) => {
        emit('closeSidebar',val,pageIndex);
    };
    const handleClose = () => {
        emit('handleClose');
    };
</script>