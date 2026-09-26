<template>
    <div>
        <span
            class="project-status-name cursor-pointer d-inline-block text-ellipsis ah-status-ink"
            :class="{'font-size-13 font-weight-400 border-radius-7-px' : clientWidth > 767 ,'font-size-16 font-weight-500 border-radius-6-px d-block align-items-center justify-content-center text-ellipsis' : clientWidth <=767}"
            :style="chipStyle"
            @click="isVisible = true"

        >
            {{ projectStatus.name }}
        </span>
        <Sidebar
            v-if="checkPermission('project.project_list',projectData?.isGlobalPermission) == true && checkPermission('project.project_status_change',projectData?.isGlobalPermission) === true"
            className="task-status-sidebar"
            v-model:visible="isVisible"
            :title="$t('ProjectSlider.select_project_status')"
            :enable-search="true"
            :options="options"
            @update:value="(val) => projectStatufun(projectStatus,val)"
            :listenKeys="true"
        >
        </Sidebar>
    </div>
</template>
<script setup>
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import { useCustomComposable } from '@/composable';
    import { statusChipStyle } from '@/utils/statusChipColors';

    import { computed, ref, defineProps, inject } from 'vue';

    const emit = defineEmits(["update:projectstatus"]);
    const { checkPermission } = useCustomComposable();


    const props = defineProps({
        projectKey: {
            type: [String, Number],
            required: true
        },
    });

    const isVisible = ref(false);
    const projectData = inject("selectedProject");
    const clientWidth = inject("$clientWidth");

    const projectStatus = computed(() => {
        return projectData.value.projectStatusData.find((status) => status.value.toLowerCase() === props.projectKey.toLowerCase());
    });
    const chipStyle = computed(() => statusChipStyle({ textColor: projectStatus.value?.textColor, bgColor: projectStatus.value?.backgroundColor }));

    const options = computed(() => {
        return projectData.value.projectStatusData.filter((status) => status.type !== "close").map((status) => {
            return {
                ...status,
                label: status.name,

            }
        });
    });

    const projectStatufun = (oldVal,newVal) =>{
        emit('update:projectstatus',oldVal, newVal[0])
    }
</script>

<style scoped>
* {
    box-sizing: border-box;
    outline: none;
    text-transform: none;
    text-decoration: none;
}
.project-status-name {
    border-width: 2px;
    height: 24px;
    line-height: 23px;
    padding: 0px 8px 3px 8px;
}
@media(max-width: 767px){
    .project-status-name{min-width: 100%;height: 38px;width: 100%;border-radius: 6px;padding: 7px 8px;text-align: center;}
}
</style>
