<template>
    <nav v-if="tabs.length > 1" class="tv-tabs" aria-label="Timesheet views">
        <router-link
            v-for="tab in tabs"
            :key="tab.key"
            :to="{ name: tab.route, params: { cid } }"
            class="tv-tab"
            :class="{ 'is-active': tab.key === active }"
            :aria-current="tab.key === active ? 'page' : null"
        >{{ $t(tab.label) }}</router-link>
    </nav>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useCustomComposable } from '@/composable';

defineOptions({ name: 'TimesheetTabs' });
const props = defineProps({ active: { type: String, default: 'mine' } });
const companyId = inject('$companyId');
const { checkPermission } = useCustomComposable();

const cid = computed(() => (companyId && companyId.value) || companyId || '');
const allowed = (key) => checkPermission(key) !== null && checkPermission(key) !== undefined;
const tabs = computed(() => [
    { key: 'mine', label: 'Time.tab_mine', route: 'User Timesheet', show: allowed('sheet_settings.user_timesheet') },
    { key: 'project', label: 'Time.tab_project', route: 'project Timesheet', show: allowed('sheet_settings.project_timesheet') },
    { key: 'workload', label: 'Time.tab_workload', route: 'Workload Timesheet', show: allowed('sheet_settings.workload_timesheet') },
    { key: 'tracker', label: 'Time.tab_tracker', route: 'Tracker Timesheet', show: allowed('sheet_settings.tracker_timesheet') },
].filter((t) => t.show || t.key === props.active));
</script>
