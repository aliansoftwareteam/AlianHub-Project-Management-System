<template>
    <nav class="rp-tabs">
        <router-link
            v-for="tab in tabs" :key="tab.name"
            class="rp-tab" :class="{ 'is-active': current === tab.name }"
            :to="{ name: tab.name, params: { cid } }"
        >{{ $t(tab.label) }}</router-link>
    </nav>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

defineOptions({ name: 'ReportsTabs' });

const route = useRoute();
const router = useRouter();

const cid = computed(() => String(route.params.cid || ''));
const current = computed(() => String(route.name || ''));

const ALL = [
    { name: 'Portfolio', label: 'Reports.tab_portfolio' },
    { name: 'SprintReport', label: 'Reports.tab_sprint' },
    { name: 'VelocityFlow', label: 'Reports.tab_velocity' },
    { name: 'MilestonesReport', label: 'Reports.tab_milestones' },
    { name: 'VarianceReport', label: 'Reports.tab_variance' },
    { name: 'CustomReport', label: 'Reports.tab_custom' },
];

const tabs = computed(() => ALL.filter((tab) => router.hasRoute(tab.name)));
</script>
