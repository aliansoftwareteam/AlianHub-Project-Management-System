<template>
    <nav v-if="tabs.length > 1" class="ah-tabs rpt__tabs" :aria-label="$t('UserTimesheet.views_nav')">
        <router-link
            v-for="tab in tabs"
            :key="tab.key"
            :to="{ name: tab.route, params: { cid }, query: carried }"
            class="ah-tab rpt__tab"
            :class="{ 'is-active': tab.key === active }"
            :aria-current="tab.key === active ? 'page' : null"
            :data-test="`time-tab-${tab.key}`"
        >{{ $t(tab.label) }}</router-link>
    </nav>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { useCustomComposable } from '@/composable';
import { canApprove } from '@/views/Approvals/approvalAccess';
import { sharedQuery } from '@/views/Timesheet/report/reportQuery';
import '@/views/Timesheet/report/report.css';

defineOptions({ name: 'TimesheetTabs' });
const props = defineProps({ active: { type: String, default: 'mine' } });
const companyId = inject('$companyId');
const { checkPermission } = useCustomComposable();
const { getters } = useStore();
const route = useRoute();

const cid = computed(() => (companyId && companyId.value) || companyId || '');
const carried = computed(() => sharedQuery(route.query));
const allowed = (key) => checkPermission(key) !== null && checkPermission(key) !== undefined;
const tabs = computed(() => [
    { key: 'mine', label: 'Time.tab_mine', route: 'User Timesheet', show: allowed('sheet_settings.user_timesheet') },
    { key: 'project', label: 'Time.tab_project', route: 'project Timesheet', show: allowed('sheet_settings.project_timesheet') },
    { key: 'workload', label: 'Time.tab_workload', route: 'Workload Timesheet', show: allowed('sheet_settings.workload_timesheet') },
    { key: 'tracker', label: 'Time.tab_tracker', route: 'Tracker Timesheet', show: allowed('sheet_settings.tracker_timesheet') },
    { key: 'approvals', label: 'Time.approvals', route: 'Approvals', show: canApprove(getters['settings/companyUserDetail']) },
].filter((t) => t.show || t.key === props.active));
</script>
