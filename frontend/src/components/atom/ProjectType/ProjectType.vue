<template>
    <div>
        <span class="cursor-pointer project-type-name" :class="{'font-size-13 font-weight-400' : clientWidth > 767, 'font-size-16' : clientWidth <=767}" @click="checkMilestone" :title="projectData.ProjectType ? projectData.ProjectType : 'Fix'">{{projectData.ProjectType ? projectData.ProjectType :"Fix" }}</span>

        <Sidebar
            v-if="checkPermission('project.project_list',projectData?.isGlobalPermission) === true && checkPermission('project.project_type',projectData?.isGlobalPermission) === true"
            v-model:visible="isVisible"
            :title="$t('Toast.Select_Project_Type')"
            :enable-search="true"
            :options="projectTypeArray.map((x) => {return {label: x.name}})"
            @selected="$emit('selected', $event)"
            :listenKeys="true"
        />
    </div>
</template>

<script setup>
    import * as env from '@/config/env';
    import { apiRequest } from '@/services';
    import { ref ,inject,defineProps} from 'vue';
    import { useCustomComposable } from '@/composable';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    const projectTypeArray = ref([{name:'Hourly'},{name:'Fix'}]);
    const props = defineProps({
        projectData: {
            type: Object,
        }
    });

    const { checkPermission } = useCustomComposable();

    defineEmits(["selected"]);

    const isVisible = ref(false);
    const clientWidth = inject("$clientWidth");

    // check milestone is created or not
    const checkMilestone = async() => {     
        try {
            const result = await apiRequest("get",`${env.MILESTONE}/${props.projectData._id}`);
            if(result.status === 200){
                if(result?.data && Object.keys(result?.data)?.length){
                    isVisible.value = false;
                }else{
                    isVisible.value = true;
                }
            }else{
                isVisible.value = true;
            }
        } catch (error) {
            isVisible.value = true;
            console.error('Error in getting the milestone');
        }
    }
</script>
<style scoped>
.project-type-name{
   line-height: 19.24px;
}
</style>
