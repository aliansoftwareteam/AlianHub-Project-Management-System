<template>
    <Sidebar
        themed
        width="374px"
        :defaultLayout="false"
        :visible="isCustomFields"
        :zIndex="8"
        :className="'customFieldSidebar'"
        :title="title"
        :closeOnBackDrop="false"
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
                :round="round"
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
    const emit = defineEmits(['customFieldStore','closeSidebar','handleClose','update:isCustomField']);

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

    const addingAnother = ref(false);
    const round = ref(0);

    /* Every host closes the drawer once its save went through. After "Save and add another" that close starts the next field
       instead, and the host, which binds isCustomField with v-model, is told the drawer is still open. */
    watch(() => props.isCustomField, (newVal) => {
        if (!newVal && addingAnother.value) {
            addingAnother.value = false;
            round.value += 1;
            emit('update:isCustomField', true);
            return;
        }
        isCustomFields.value = newVal;
    });
    watch(() => props.componentDetail, (newVal) => {
        componentDetails.value = newVal;
    });
    watch(() => props.customFieldObject, (newVal) => {
        customFieldObjects.value = newVal;
    });
    const customFieldStores = (val,isEdit,another = false) => {
        addingAnother.value = another === true && !isEdit;
        emit('customFieldStore',val,isEdit);
    };
    const handleCloseSidebar = (val,pageIndex) => {
        emit('closeSidebar',val,pageIndex);
    };
    const handleClose = () => {
        addingAnother.value = false;
        emit('handleClose');
    };
</script>
<style src="../theme.css"></style>
