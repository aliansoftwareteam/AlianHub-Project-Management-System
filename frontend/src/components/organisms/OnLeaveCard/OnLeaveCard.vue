<template>
    <div class="olc">
        <div v-if="!configuredProjects.length" class="olc-msg">{{ $t('dashboardCard.on_leave_setup_hint') }}</div>
        <CardSkeleton v-else-if="loading && !rows.length" :counters="3" :rows="4" />
        <template v-else>
            <!-- AB / PR headcounts for the selected window -->
            <div class="olc-stats">
                <div class="olc-stat olc-stat-ab">
                    <div class="olc-stat-num">{{ stats.absent }}</div>
                    <div class="olc-stat-label">{{ $t('dashboardCard.on_leave_absent') }}</div>
                </div>
                <div class="olc-stat olc-stat-pr">
                    <div class="olc-stat-num">{{ stats.present }}</div>
                    <div class="olc-stat-label">{{ $t('dashboardCard.on_leave_present') }}</div>
                </div>
                <div class="olc-stat">
                    <div class="olc-stat-num">{{ stats.tickets }}</div>
                    <div class="olc-stat-label">{{ $t('dashboardCard.on_leave_tickets') }}</div>
                </div>
            </div>

            <div v-if="!rows.length" class="olc-msg">{{ $t('dashboardCard.on_leave_no_one') }}</div>
            <div v-else class="olc-table-wrap">
                <table class="olc-table">
                    <thead>
                        <tr>
                            <th>{{ $t('dashboardCard.lwt_user') }}</th>
                            <th>{{ $t('dashboardCard.on_leave_ticket') }}</th>
                            <th>{{ $t('dashboardCard.on_leave_period') }}</th>
                            <th>{{ $t('dashboardCard.status') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in rows" :key="r.taskId">
                            <td class="olc-user">
                                <div class="olc-user-cell">
                                    <UserProfile
                                        :data="{ image: getUserProfile(r.userId).Employee_profileImageURL || r.avatar, title: r.userName }"
                                        :showDot="false"
                                        width="22px"
                                        :thumbnail="'30x30'"
                                    />
                                    <span>{{ r.userName }}</span>
                                </div>
                            </td>
                            <td class="olc-ticket" :title="r.taskName">
                                <span v-if="r.taskKey" class="olc-key">{{ r.taskKey }}</span>{{ r.taskName }}
                            </td>
                            <td class="olc-dates">{{ periodOf(r) }}</td>
                            <td>
                                <span class="olc-status" :style="statusStyle(r.statusKey)">{{ statusName(r.statusKey) }}</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>

<script>
export default { name: 'OnLeaveCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { resolveCardRange } from '@/composable/useResourceWorkload';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';

// On Leave card — leaves are tracked as tickets in a designated project
// (picked in the card settings) with an "approved" status (also picked
// there). Shows the tickets whose leave period overlaps the selected window
// plus the AB (absent) / PR (present) headcounts. Timerange 0 = Auto →
// follows the dashboard's global date range.
const props = defineProps({
    cardUID: { type: [String, Number], default: '' },
    componentId: { type: String, default: '' },
    cardData: { type: Object, default: () => ({}) },
    filterData: { type: [Array, Object], default: () => [] },
    refreshTrigger: { type: [Number, String], default: 0 },
    companyUserDetail: { type: Object, default: () => ({}) },
    allProjectsArrayFilter: { type: Array, default: () => [] },
    taskStatusArray: { type: [Array, Object], default: () => ({}) },
});

const globalRange = inject('dashboardGlobalRange', null);

// Avatars resolve through the users store (Employee_profileImageURL) so the
// UserProfile atom can handle Wasabi keys and the default-avatar fallback.
const { getters } = useStore();
const storeUsers = computed(() => getters['users/users'] || []);
function getUserProfile(id) {
    return storeUsers.value.find((u) => String(u._id) === String(id)) || {};
}

const rows = ref([]);
const stats = ref({ absent: 0, present: 0, totalUsers: 0, tickets: 0 });
const loading = ref(false);

const configuredProjects = computed(() => (Array.isArray(props.cardData?.projectId) ? props.cardData.projectId : []));

const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 1; // default Today; 0 = Auto
});

// statusKey → { name, color } from the company status settings.
const statusList = computed(() => {
    const src = props.taskStatusArray;
    return Array.isArray(src) ? src : (src && Array.isArray(src.settings) ? src.settings : []);
});
const statusName = (key) => statusList.value.find((s) => s.key === key)?.name || '—';
const statusStyle = (key) => {
    const color = statusList.value.find((s) => s.key === key)?.color;
    return color ? { backgroundColor: `${color}22`, color } : {};
};

const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const periodOf = (r) => {
    const from = fmt(r.startDate);
    const to = fmt(r.dueDate);
    if (from && to && from !== to) return `${from} – ${to}`;
    return from || to || '—';
};

const load = async () => {
    if (!configuredProjects.value.length) return;
    loading.value = true;
    try {
        const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
        const res = await apiRequest('post', `${env.DASHBOARD}/on-leave`, {
            projectIds: configuredProjects.value,
            statusKeys: props.cardData?.statusArray || [],
            dateFrom,
            dateTo,
        });
        const d = res && res.data && res.data.status ? (res.data.data || {}) : {};
        rows.value = d.rows || [];
        stats.value = d.stats || { absent: 0, present: 0, totalUsers: 0, tickets: 0 };
    } catch (e) {
        console.error('OnLeaveCard fetch error:', e);
        rows.value = [];
        stats.value = { absent: 0, present: 0, totalUsers: 0, tickets: 0 };
    } finally {
        loading.value = false;
    }
};

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
// In Auto mode, re-fetch whenever the dashboard-level range moves.
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped>
.olc { height: 100%; width: 100%; padding: 8px 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.olc-msg { color: #9aa0b4; font-size: 12px; padding: 10px 0; }
.olc-stats { display: flex; gap: 10px; }
.olc-stat { flex: 1; background: #f5f7fb; border-radius: 8px; padding: 8px; text-align: center; }
.olc-stat-num { font-size: 24px; font-weight: 700; color: #3a3f52; line-height: 1.1; }
.olc-stat-ab .olc-stat-num { color: #e11d48; }
.olc-stat-pr .olc-stat-num { color: #0f766e; }
.olc-stat-label { font-size: 10.5px; color: #6b7280; margin-top: 2px; }
.olc-table-wrap { overflow: auto; }
.olc-table { width: 100%; border-collapse: collapse; font-size: 12px; white-space: nowrap; }
.olc-table th { text-align: left; color: #6b7280; font-weight: 600; padding: 4px 6px; border-bottom: 1px solid #eef0f6; position: sticky; top: 0; background: #fff; }
.olc-table td { padding: 5px 6px; border-bottom: 1px solid #f4f5f9; color: #3a3f52; }
.olc-user { font-weight: 600; }
.olc-user-cell { display: flex; align-items: center; gap: 6px; }
.olc-ticket { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.olc-key { color: #9aa0b4; font-size: 11px; margin-right: 5px; }
.olc-dates { color: #6b7280; }
.olc-status { display: inline-block; padding: 1px 8px; border-radius: 10px; background: #f3f4f6; font-size: 11px; }
</style>
