<template>
    <div>
        <span class="project-type-name cursor-pointer"  :class="{'font-size-13 font-weight-400' : clientWidth > 767, 'font-size-16' : clientWidth <=767}"
            :style="[{padding : clientWidth > 767 ? '0' : '10px 0px'}]"
         @click="isVisible = true" :title="projectData?.ProjectCurrency?.symbol + '-' + projectData?.ProjectCurrency?.code">{{projectData?.ProjectCurrency?.symbol}} - {{projectData?.ProjectCurrency?.code}}</span>
        <Sidebar
            v-if="checkPermission('project.project_list',projectData?.isGlobalPermission) === true && checkPermission('project.project_currency',projectData?.isGlobalPermission) === true"
            v-model:visible="isVisible"
            :title="$t('ProjectDetails.select_currency')"
            :enable-search="true"
            :listenKeys="true"
            :options="allCurrency"
            @selected="$emit('selected', $event)"
        />
    </div>
</template>

<script setup>

defineComponent({
    name: 'Currency-component',
})
import { useStore } from "vuex";
import { defineComponent , ref , computed , inject } from 'vue';
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import { useCustomComposable } from "@/composable";

const clientWidth = inject("$clientWidth");
const allCurrency = computed(() => JSON.parse(JSON.stringify((getters['settings/allCurrencyArray'].filter((x)=> x.isDelete === true).map((xt)=>({...xt, label : xt.name}))))));
const { getters } = useStore();
const { checkPermission } = useCustomComposable();

defineProps({
    projectData: {
        type: Object,
    },
});

defineEmits(["selected"]);
const isVisible = ref(false);
</script>
<style scoped>
.project-type-name{
    line-height: 19.24px;
}
</style>