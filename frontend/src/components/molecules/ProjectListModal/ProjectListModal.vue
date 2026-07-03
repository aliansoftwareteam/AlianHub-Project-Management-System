<template>
    <Modal
        :modelValue="modelValue"
        :header="true"
        :footer="false"
        :closeIcon="true"
        :closeOnBackdrop="true"
        headerClasses="p-20px pb-15px border-0"
        bodyClasses="p-0 mh-550 overflow-auto"
        :styles="{ 'min-width': '520px', 'max-width': '760px', 'z-index': 10 }"
        @close="$emit('close')"
    >
        <template #header>
            <div class="d-flex align-items-center justify-content-between w-100">
                <h3 class="m-0 font-size-16">
                    {{ title }}
                    <span v-if="!loading" class="plm-count">({{ projects.length }})</span>
                </h3>
                <img :src="cancelIcon" class="cursor-pointer cancel__icon-img ml-2" alt="close" @click.prevent="$emit('close')" />
            </div>
        </template>
        <template #body>
            <div class="plm">
                <!-- Skeleton while the drill-down list loads -->
                <div v-if="loading" class="plm-table-wrap">
                    <table class="plm-table">
                        <thead>
                            <tr>
                                <th>{{ $t('dashboardCard.location') }}</th>
                                <th>{{ $t('dashboardCard.plm_type') }}</th>
                                <th>{{ $t('dashboardCard.status') }}</th>
                                <th v-if="showWorked">{{ $t('dashboardCard.plm_worked_in_period') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="n in 6" :key="n">
                                <td><div class="plm-skel plm-skel-name"></div></td>
                                <td><div class="plm-skel plm-skel-type"></div></td>
                                <td><div class="plm-skel plm-skel-status"></div></td>
                                <td v-if="showWorked"><div class="plm-skel plm-skel-worked"></div></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div v-else-if="!projects.length" class="plm-msg">{{ $t('dashboardCard.no_data_available') }}</div>
                <div v-else class="plm-table-wrap">
                    <table class="plm-table">
                        <thead>
                            <tr>
                                <th>{{ $t('dashboardCard.location') }}</th>
                                <th>{{ $t('dashboardCard.plm_type') }}</th>
                                <th>{{ $t('dashboardCard.status') }}</th>
                                <th v-if="showWorked">{{ $t('dashboardCard.plm_worked_in_period') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in projects" :key="p._id">
                                <td class="plm-name" :title="p.name">{{ p.name }}</td>
                                <td class="plm-type">{{ p.type }}</td>
                                <td>
                                    <!-- Colored dot + name from the project's own status
                                         palette (same pattern as the project filters). -->
                                    <span class="plm-status">
                                        <span class="plm-status-dot" :style="{ backgroundColor: p.statusColor || '#9aa0b4' }"></span>
                                        {{ p.statusName || prettyStatus(p.status) }}
                                    </span>
                                </td>
                                <td v-if="showWorked" class="plm-worked">
                                    <span class="plm-dot" :class="{ 'plm-dot-on': p.isWorking }"></span>
                                    {{ p.isWorking ? $t('dashboardCard.plm_yes') : $t('dashboardCard.plm_no') }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </template>
    </Modal>
</template>

<script>
export default { name: 'ProjectListModal' };
</script>

<script setup>
import Modal from '@/components/atom/Modal/Modal.vue';

// Drill-down modal behind the project-count dashboard cards (Project Pulse,
// Active Projects, Projects by Type, Running Projects): lists the projects a
// clicked count/bar is made of, with their type and colour-coded status.
defineProps({
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: '' },
    // [{ _id, name, type, status, statusName, statusColor, statusType, isWorking? }]
    projects: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    // Show the "worked in period" column (Project Pulse drill-down).
    showWorked: { type: Boolean, default: false },
});
defineEmits(['close']);

const cancelIcon = require('@/assets/images/cancel_icon.png');

// Fallback when a project's palette has no entry for its current status —
// humanize the raw snake_case value ("in_development" → "In Development").
const prettyStatus = (s) => String(s || '—').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
</script>

<style scoped>
.plm { min-width: 480px; }
.plm-msg { color: #9aa0b4; font-size: 12px; padding: 16px 20px; }
.plm-count { color: #9aa0b4; font-weight: 500; font-size: 13px; }
.plm-table-wrap { overflow: auto; max-height: 480px; padding: 0 20px 16px 20px; }
.plm-table { width: 100%; border-collapse: collapse; font-size: 12.5px; white-space: nowrap; }
.plm-table th { text-align: left; color: #6b7280; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #eef0f6; position: sticky; top: 0; background: #fff; text-transform: capitalize; }
.plm-table td { padding: 6px 8px; border-bottom: 1px solid #f4f5f9; color: #3a3f52; }
.plm-name { max-width: 340px; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.plm-type { color: #6b7280; }
.plm-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; text-transform: capitalize; }
.plm-status-dot { width: 9px; height: 9px; border-radius: 2px; flex: none; }
.plm-worked { color: #6b7280; }
.plm-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #d1d5db; margin-right: 5px; vertical-align: middle; }
.plm-dot-on { background: #0d9488; }
.plm-skel { background: linear-gradient(90deg, #eef0f6 25%, #e3e7f1 37%, #eef0f6 63%); background-size: 400% 100%; animation: plm-shimmer 1.4s ease infinite; border-radius: 4px; height: 13px; }
@keyframes plm-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
.plm-skel-name { width: 240px; }
.plm-skel-type { width: 70px; }
.plm-skel-status { width: 110px; }
.plm-skel-worked { width: 46px; }
</style>
