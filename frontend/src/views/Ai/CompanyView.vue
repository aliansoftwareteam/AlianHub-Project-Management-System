<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('CompanyView.title') }}</div>
            </div>
            <div class="ai-page__body ah-scroll">
                <p class="ai-lead">{{ $t('CompanyView.lead') }}</p>
                <div v-if="orgLoading || flowLoading" class="ah-empty" data-test="loading">{{ $t('CompanyView.loading') }}</div>
                <EmptyState v-else-if="offNotice" data-test="off" :title="$t('CompanyView.off_title')" :message="$t('CompanyView.off_body')" />
                <template v-else>
                    <CompanyOrgChart :data="orgChart" :failed="orgFailed" @retry="loadOrg(true)" />
                    <CompanyFlowBoard :data="flowBoard" :failed="flowFailed" @retry="loadFlow" />
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import { useDispatcherChanges } from "@/utils/dispatcher";
import AiSidebar from "./AiSidebar.vue";
import CompanyOrgChart from "./CompanyOrgChart.vue";
import CompanyFlowBoard from "./CompanyFlowBoard.vue";
import { useCompanyView } from "./useCompanyView";

defineOptions({ name: "CompanyView" });

const { orgChart, flowBoard, on, loadOrgChart, loadFlowBoard } = useCompanyView();
const orgLoading = ref(true);
const flowLoading = ref(true);
const orgFailed = ref(false);
const flowFailed = ref(false);
const offNotice = computed(() => !orgLoading.value && !orgFailed.value && !on.value);

const loadOrg = async (force = false) => {
    orgFailed.value = false;
    try {
        await loadOrgChart(force);
    } catch {
        orgFailed.value = true;
    } finally {
        orgLoading.value = false;
    }
};

const loadFlow = async () => {
    flowFailed.value = false;
    try {
        await loadFlowBoard();
    } catch {
        flowFailed.value = true;
    } finally {
        flowLoading.value = false;
    }
};

const refresh = () => Promise.all([loadOrg(true), loadFlow()]);

onMounted(async () => {
    await loadOrg();
    if (on.value) await loadFlow();
    else flowLoading.value = false;
});

useDispatcherChanges(() => { if (on.value) refresh(); });
</script>

<style>
@import "./style.css";
@import "./company.css";
</style>
