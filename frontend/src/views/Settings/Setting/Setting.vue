<template>
<div class="main-setting_wrapper style-scroll p-1">
    <div v-if="checkPermission('settings.settings_edit_company') !== null || checkPermission('settings.settings_task_priority') !== null
        || checkPermission('settings.milestone_weekly_range') !== null || checkPermission('settings.settings_file_extensions') !== null
        || checkPermission('settings.settings_project_milestone_status') !== null">
        <div class="d-flex justify-content-between flex-wrap">
            <div class="task_priority_wrapper">
                <SettingCompanyDetailsVue v-if="checkPermission('settings.settings_edit_company') !== null"
                    :editPermission="checkPermission('settings.settings_edit_company')" />
                <SettingTaskPriorityVue v-if="checkPermission('settings.settings_task_priority') !== null"
                    :editPermission="checkPermission('settings.settings_task_priority')" />
                <SettingMilestoneWeeklyRange v-if="checkPermission('settings.milestone_weekly_range') !== null"
                    :editPermission="checkPermission('settings.milestone_weekly_range')" />
                <settingFileExtesnsions v-if="checkPermission('settings.settings_file_extensions') !== null"
                    :editPermission="checkPermission('settings.settings_file_extensions')" />
            </div>
            <div class="task_priority_wrapper">
                <ShareRefferalCode/>
                <SettingMilestoneStatus v-if="checkPermission('settings.settings_project_milestone_status') !== null"
                    :editPermission="checkPermission('settings.settings_project_milestone_status')" />
                <SettingCurrency v-if="checkPermission('project.project_milestone') !== null" />
                <!--
                    Screenshot retention is gated inside the component itself
                    (renders nothing unless companyUser.roleType === 1), so we
                    can mount it unconditionally here and let it self-hide for
                    non-owners.
                -->
                <SettingScreenshotRetention />
                <SettingTimeReminder />
            </div>
        </div>
    </div>
    <div v-else class="text-center">
        <img :src="accesDenied" />
    </div>
</div>
</template>

<script setup>
import SettingCompanyDetailsVue from "@/components/molecules/Setting/SettingCompanyDetails.vue";
import SettingTaskPriorityVue from "@/components/molecules/Setting/SettingTaskPriority.vue";
import SettingMilestoneWeeklyRange from "@/components/molecules/Setting/SettingMilestoneWeeklyRange.vue";
import SettingMilestoneStatus from "@/components/molecules/Setting/SettingMilestoneStatus.vue";
import settingFileExtesnsions from "@/components/molecules/Setting/SettingFileExtensions.vue";
import SettingCurrency from "@/components/molecules/Setting/SettingCurrencys.vue";
import SettingScreenshotRetention from "@/components/molecules/Setting/SettingScreenshotRetention.vue";
import SettingTimeReminder from "@/components/molecules/Setting/SettingTimeReminder.vue";
import { defineComponent} from "vue";
import { useCustomComposable } from '@/composable';
const accesDenied = require("@/assets/images/access_denied_img.png");
const { checkPermission } = useCustomComposable();
defineComponent({
    name: "SettingComponent",
    components: {
        SettingCompanyDetailsVue,
        SettingMilestoneStatus,
        SettingTaskPriorityVue,
        SettingMilestoneWeeklyRange,
        settingFileExtesnsions,
        SettingCurrency,
        SettingScreenshotRetention,
        SettingTimeReminder
    }
})



</script>

<style scoped>
/* .main-setting_wrapper{
    height: calc(100vh - 101px);
} */
</style>