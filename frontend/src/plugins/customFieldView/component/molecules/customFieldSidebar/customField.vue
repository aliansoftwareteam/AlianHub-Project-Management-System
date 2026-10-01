<template>
    <div :class="`overflow-auto custom_field_content style-scroll ${pageIndex === 1 ? 'custom_field_content_field' : ''}`">
        <template v-if="pageIndex === 0">
            <button v-for="(item,index) in fieldTypes" :key="index" type="button" class="custom_field_type" :data-field-type="item.cfType" @click="pageIndex= pageIndex+1,componentDetail=item">
                <CustomFieldComponentStructure
                    :cfTitle="item.cfTitle"
                    :cfDescrption="item.cfDescrption"
                    :cfIcon="item.cfIcon"
                    :cfPrimaryColor="item.cfPrimaryColor"
                    :icon="item.icon"
                />
            </button>
        </template>
        <div v-else-if="pageIndex === 1">
            <div v-if="currentCompany?.planFeature?.customFields">
                <button v-if="props.pageInd === 0" type="button" class="ah-btn ah-btn--ghost ah-btn--sm custom_field_back" data-field-back :title="$t('CustomField.back_to_types')" @click="backToTypes(false)">
                    <ShellIcon name="chevronLeft" :size="13" />{{ $t('CustomField.back') }}
                </button>
                <div>
                    <CustomFieldComponentStructure
                        :cfTitle="componentDetail.cfTitle"
                        :cfDescrption="componentDetail.cfDescrption"
                        :cfIcon="componentDetail.cfIcon"
                        :cfPrimaryColor="componentDetail.cfPrimaryColor"
                        :icon="componentDetail.icon"
                    />
                </div>
                <div class="ml-20px mr-20px">
                    <ModuleFieldEditor
                        v-if="fieldTypeUi(componentDetail.cfType)"
                        :fieldType="componentDetail.cfType"
                        :field="props.customFieldObject"
                        @save="customFieldStore"
                        @cancel="emit('close')"
                    />
                    <template v-else>
                        <CustomFieldsTabComponent
                            :tabIndexComp="tabIndex"
                            :componentDetail="componentDetail"
                            @handleIndex="(val) => tabIndex = val"
                        />
                        <CustomFieldsComponent
                            :tabIndex='tabIndex'
                            :componentDetail="componentDetail"
                            :customFieldObject="props.customFieldObject"
                            @handleFunction="customFieldStore"
                            @tabIndexUpdate="(val) => tabIndex = val"
                            @closeSidebar="emit('close')"
                            :isType="isType"
                        />
                    </template>
                </div>
            </div>
            <div v-else>
                <UpgradePlan
                    :buttonText="$t('Upgrades.upgrade_your_plan')"
                    :lastTitle="$t('Upgrades.to_unlock_custom_field')"
                    :secondTitle="$t('Upgrades.unlimited')"
                    :firstTitle="$t('Upgrades.upgrade_to')"
                    :message="$t('Upgrades.the_feature_not_available')"
                />
            </div>
        </div>
    </div>
</template>
<script setup>
    import { useStore } from 'vuex';
    import { ref, computed, inject } from "vue";
    import { useI18n } from "vue-i18n";
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import CustomFieldsComponent from "../../molecules/customFieldSidebar/customFieldsComponent/customFieldsComponent.vue";
    import CustomFieldsTabComponent from "../../atom/customFieldSidebar/customFieldsTabComponent/customFieldsTabComponent.vue"
    import CustomFieldComponentStructure from "../../atom/customFieldSidebar/customFieldComponentStructure/customFieldComponentStructure.vue";
    import ModuleFieldEditor from "@/plugins/customFieldView/fieldTypes/ModuleFieldEditor.vue";
    import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
    import { fieldTypeCatalogue, fieldTypeUi } from "@/plugins/customFieldView/fieldTypes";

    const {getters} = useStore();
    const { t } = useI18n();
    const props = defineProps({
        componentDetails:{
            type:Object,
            default:() => {}
        },
        pageInd:{
            type:Number,
            default:0
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
    const tabIndex = ref(1);
    const pageIndex = ref(props.pageInd);
    const componentDetail = ref(props.componentDetails);

    /* Project fields are shown by the older per-type components only, so the types the registry adds are offered for task fields. */
    const forProject = inject('customFieldForProject', false);
    const fieldTypes = computed(() => (forProject ? getters["settings/customFields"] : fieldTypeCatalogue(getters["settings/customFields"], t)));
    const currentCompany = computed(() => getters["settings/selectedCompany"])
    const emit = defineEmits(['customFieldStore','closeSidebar','close']);
    const customFieldStore = (val,isEdit) => {
        val.fieldPrimaryColor = componentDetail.value.cfPrimaryColor;
        val.fieldBackgroundColor = componentDetail.value.cfBackgroundColor;
        val.isDelete = true;
        emit('customFieldStore',val,isEdit);
    }
    const backToTypes = (val) => {
        emit('closeSidebar',val,pageIndex.value);
        pageIndex.value = pageIndex.value - 1;
        tabIndex.value = 1;
    };
</script>
<style scoped>
    @import "./style.css";
</style>
