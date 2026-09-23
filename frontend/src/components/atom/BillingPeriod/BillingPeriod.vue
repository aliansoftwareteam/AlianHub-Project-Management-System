<template>
    <div>
        <span class="black project-billing-name cursor-pointer" @click="checkMilestone" :class="{'font-size-13 font-weight-400' : clientWidth > 767, 'font-size-16' : clientWidth <=767}" :style="[{padding : clientWidth > 767 ? '0' : '10px 0px'}]" :title="props.projectData.BillingPeriod ? props.projectData.BillingPeriod : ''">{{props.projectData.BillingPeriod ? props.projectData.BillingPeriod :"'N/A'" }}</span>
        <Sidebar
            v-model:visible="isVisible"
            :title="$t('Projects.select_billing_period')"
            :enable-search="true"
            :options="bilingValue"
            @selected="$emit('selected', $event)"
            :listenKeys="true"
        />
    </div>
</template>

<script setup>
    // import
    import * as env from '@/config/env';
    import { apiRequest } from '@/services';
    import { ref , defineProps ,onMounted,inject } from 'vue';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    // Props
    const props = defineProps({
        projectData: {
            type: Object,
        }
    })
    // Emits
    defineEmits(["selected"]);
    // variable
    const bilingValue = ref([]);
    const isVisible = ref(false);
    const clientWidth = inject("$clientWidth");
    // onMounted
    onMounted(async () => {
        try {
            const result = await apiRequest("get", `${env.MILESTONE_BILLING_PERIOD}`);
            if (result.status === 200) {
                const settings = result?.data?.[0]?.settings || [];
                if (settings.length) {
                    bilingValue.value.push(...settings.map((x) => ({ label: x })));
                }
            }
        } catch (error) {
            console.error('Error in getting the milestone billing period');
        }
    });
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
    };
</script>

<style>
.project-billing-name{
    line-height: 19.24px;
}
</style>