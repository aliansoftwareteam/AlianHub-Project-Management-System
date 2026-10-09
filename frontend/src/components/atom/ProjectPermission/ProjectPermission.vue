<template>
    <div>
        <Sidebar :class="[{'position-re':!currentCompany?.planFeature?.projectWisePermisson}]" width="1329px" :title="$t('Projects.project_permissions')">
            <template #head-right>
                <img :src="closeBlueImage" alt="closeButton" class="cursor-pointer" @click="$emit('isClose',true)"/>
            </template>
            <template #body>
                <div :class="[{'pointer-event-none opacity-5 blur-3-px':!currentCompany?.planFeature?.projectWisePermisson}]" class="add_permission_project project-permission-bg-white d-flex justify-content-between align-items-center"> 
                    <div class="add_permission_para">
                        <span class="main_para d-block project-permission-black project-permission-font-size-14 font-ui project-permission-font-weight-500" v-if="projectRawRules?.length">{{$t('Permissions.project_permission_title_enable')}}</span>
                        <span class="main_para d-block project-permission-black project-permission-font-size-14 font-ui project-permission-font-weight-500" v-else>{{$t('Permissions.project_permission_title_disable')}}</span>
                        <span v-if="projectRawRules?.length === 0" class="second_para d-block project-permission-GunPowder project-permission-font-size-12 font-ui project-permission-font-weight-400">{{$t('Permissions.project_permission_description')}}.</span>
                    </div>
                    <div v-if="checkPermission('settings.settings_security_permissions') == true">
                        <button :disabled="!currentCompany?.planFeature?.projectWisePermisson" v-if="projectRawRules?.length === 0" class="project-permission-bg-white permissionButton project-permission-border-primary project-permission-font-size-16 project-permission-blue mr-010 cursor-pointer" :class="[{'disableButton project-permission-font-size-16':isSpinner}]" @click="applyProjectPermision">{{$t('Permissions.apply_permission')}}</button>
                        <button :disabled="!currentCompany?.planFeature?.projectWisePermisson" v-else class="project-permission-bg-white permissionButton project-permission-border-primary project-permission-blue mr-010 cursor-pointer project-permission-font-size-16" @click="resetProjectPermission()" :class="[{'disableButton project-permission-font-size-16':isSpinner}]">{{$t('Permissions.reset_permission')}}</button>
                    </div>
                    <div v-else-if="checkPermission('settings.settings_security_permissions') == false">
                        <button :disabled="!currentCompany?.planFeature?.projectWisePermisson" v-if="projectRawRules?.length === 0" class="project-permission-bg-white permissionButton project-permission-border-primary project-permission-font-size-16 project-permission-blue mr-010 cursor-pointer disableButton" :class="[{'disableButton project-permission-font-size-16':isSpinner}]">{{$t('Permissions.apply_permission')}}</button>
                        <button :disabled="!currentCompany?.planFeature?.projectWisePermisson" v-else class="project-permission-bg-white permissionButton project-permission-border-primary project-permission-blue mr-010 cursor-pointer project-permission-font-size-16 disableButton" :class="[{'disableButton project-permission-font-size-16':isSpinner}]">{{$t('Permissions.reset_permission')}}</button>
                    </div>
                </div>
                <SecurityPermissions v-if="projectRawRules && projectRawRules.length > 0" :from="'project_rules'" :projectData="projectData" :isSpinnerProject="isSpinner"></SecurityPermissions> 
                <div v-if="projectRawRules.length <= 0 && !currentCompany?.planFeature?.projectWisePermisson">
                    <UpgradePlan
                    :buttonText="$t('Upgrades.upgrade_your_plan')"
                    :lastTitle="$t('Upgrades.unlock_project_permission')"
                    :secondTitle="$t('Upgrades.unlimited')"
                    :firstTitle="$t('Upgrades.upgrade_to')"
                    :message="$t('Upgrades.the_feature_not_available')"
                />
                </div>
            </template>
        </Sidebar>
    </div>
</template>
<script setup>
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import { computed, defineEmits, inject, onMounted, ref } from "vue";
    import { useStore } from 'vuex';
    import SecurityPermissions from '@/views/Settings/SecurityPermissions/SecurityPermissions.vue';
    import { apiRequest } from "@/services";
    import * as env from '@/config/env';
    import { useRoute } from 'vue-router';
    import { useCustomComposable } from '@/composable';
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';

    const { getters, dispatch, commit } = useStore();
    const {checkPermission} = useCustomComposable()
    defineEmits(["isClose"])

    const props = defineProps({
        projectData:{
            type:Object,
            default:() => {}
        }
    })
    const isSpinner = ref(false)
    const projectRawRules = computed(() => {
        return getters["settings/projectRawRules"];
    });
    const currentCompany = computed(() => getters["settings/selectedCompany"]);
    const route = useRoute();

    const companyId = inject('$companyId');
    const closeBlueImage = require("@/assets/images/svg/CloseSidebar.svg");

    onMounted(() => {
        if(getters["settings/projectRawRules"] && getters["settings/projectRawRules"].length > 0){
            if(getters["settings/projectRawRules"].some((x) => x.projectId === route?.params?.id || props?.projectData?._id)){
                return;
            }else{
                dispatch("settings/setProjectRules", {pid: route?.params?.id || props?.projectData?._id})
            }
        }
        else{
            dispatch("settings/setProjectRules", {pid: route?.params?.id || props?.projectData?._id})
        }
    })

    function applyProjectPermision () {
        if(currentCompany.value?.planFeature?.projectWisePermisson){
            isSpinner.value = true;
            apiRequest("post", env.PROJECT_RULES, {
                companyId : companyId.value,
                type : 'project',
                projectId : route?.params?.id || props?.projectData?._id
            }).then(async (res) => {
                const rules = res.data.data;
                commit("settings/mutateArrangeProjectRules", {op:"added", data : rules ,projectId : route?.params?.id || props?.projectData?._id});
                rules.forEach((rule) => {
                    commit("settings/mutateProjectRules", {
                        projectId : route?.params?.id || props?.projectData?._id,
                        data: {...rule, _id: rule._id},
                        op: "added",
                    })
                })
                try {
                    await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${route?.params?.id || props?.projectData?._id}`,{updateObject: { isGlobalPermission: false }});
                    isSpinner.value = false;
                } catch (error) {
                    isSpinner.value = false;
                    console.error("Error while updating project permisson",error)
                }
            }).catch((error) => {
                isSpinner.value = false;
                console.error(error,"ERROR IN IMPORT PROJECT PERMISSION");
            });
        }
    }

    function resetProjectPermission () {
        if(currentCompany.value?.planFeature?.projectWisePermisson){
            isSpinner.value = true;
            apiRequest("delete",`${env.PROJECTRULES}/delete/${route?.params?.id || props?.projectData?._id}`).then(async () => {
                try {
                    commit('settings/mutateProjectRules',{projectId : route?.params?.id || props?.projectData?._id, op: "delete"})
                    await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${route?.params?.id || props?.projectData?._id}`,{updateObject: { isGlobalPermission: true }})
                    isSpinner.value = false;
                } catch (error) {
                    isSpinner.value = false;
                    console.error("Error while updating project permisson",error)
                }
            }).catch(() => {
                isSpinner.value = false;
            });
        }
    }
</script>

<style scoped>
.project-permission-font-size-12 {
    font-size: 12px;
}
.project-permission-font-size-14 {
    font-size: 14px;
}
.project-permission-font-size-16 {
    font-size: 16px;
}
.project-permission-font-weight-400 {
    font-weight: 400 !important;
}
.project-permission-font-weight-500 {
    font-weight: 500 !important;
}
.project-permission-bg-white {
    background-color: var(--surface);
}
.project-permission-GunPowder {
    color: var(--ink-2);
}
.project-permission-black {
    color: var(--ink);
}
.project-permission-blue {
    color: var(--brand) !important;
}
.project-permission-border-primary {
    border: 1px solid var(--brand) !important;
}
</style>

<style src="./style.css">
</style>