<template>
    <Sidebar
        themed
        width="374px"
        :defaultLayout="false"
        :visible="isCustomFields"
        :zIndex="8"
        :className="'customFieldSidebar'"
        :title="title"
        @update:visible="handleClose()"
    >
        <template #head-left>
            <span class="font-weight-bold font-size-18">{{ title }}</span>
        </template>
        <template #head-right>
            <button type="button" class="sidebar-close" :aria-label="$t('Projects.close')" :title="$t('Projects.close')" @click="handleClose()">
                <ShellIcon name="x" :size="15" />
            </button>
        </template>
        <template #body>
            <CustomFieldSidebarComponent
                @customFieldStore="customFieldStores"
                @closeSidebar="handleCloseSidebar"
                @close="handleClose()"
                :componentDetails="componentDetails && Object.keys(componentDetails).length ? componentDetails : {}"
                :pageInd="componentDetails && Object.keys(componentDetails).length ? 1 : 0"
                :customFieldObject="componentDetails && Object.keys(componentDetails).length ? customFieldObjects : {}"
                :isType="isType"
            />
        </template>
    </Sidebar>
</template>
<script setup>
    import { computed, ref, watch } from 'vue';
    import { useI18n } from 'vue-i18n';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

    const { t } = useI18n();
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

    const componentDetails = ref(props.componentDetail);
    const isCustomFields = ref(props.isCustomField);
    const customFieldObjects = ref(props.customFieldObject);
    const title = computed(() => (customFieldObjects.value?._id ? t('CustomField.edit_custom_field') : t('CustomField.create_custom_field')));

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
<style src="../theme.css"></style>
