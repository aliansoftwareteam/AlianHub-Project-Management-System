<template>
    <div class="cap-wrap">
        <div class="cap-topbar">
            <router-link :to="{ name: 'Home', params: { cid: cid } }" class="cap-home" title="Home">
                <img src="@/assets/images/svg/Home.svg" alt="Home" />
            </router-link>
            <h1 class="cap-title">{{ $t('Header.Capacity_Planning') }}</h1>
            <div class="cap-controls">
                <input v-model="from" type="date" class="form-control" />
                <input v-model="to" type="date" class="form-control" />
                <input v-model.number="hoursPerDay" type="number" min="1" max="24" class="form-control cap-hpd" :title="$t('Capacity.hours_per_day')" />
                <button class="cap-btn" @click="load">{{ $t('Capacity.apply') }}</button>
            </div>
        </div>

        <div class="cap-body">
            <div v-if="data" class="cap-totals">
                <div class="cap-stat"><b>{{ data.totals.users }}</b><span>{{ $t('Capacity.members') }}</span></div>
                <div class="cap-stat"><b>{{ r1(data.totals.totalCapacity) }}h</b><span>{{ $t('Capacity.capacity') }}</span></div>
                <div class="cap-stat"><b>{{ r1(data.totals.totalAllocated) }}h</b><span>{{ $t('Capacity.allocated') }}</span></div>
                <div class="cap-stat"><b>{{ data.totals.utilizationPct }}%</b><span>{{ $t('Capacity.utilization') }}</span></div>
                <div class="cap-stat over"><b>{{ data.totals.over }}</b><span>{{ $t('Capacity.over') }}</span></div>
            </div>
            <div class="cap-table-wrap">
                <table class="cap-table">
                    <thead>
                        <tr>
                            <th>{{ $t('Capacity.member') }}</th>
                            <th>{{ $t('Capacity.capacity') }}</th>
                            <th>{{ $t('Capacity.pto') }}</th>
                            <th>{{ $t('Capacity.allocated') }}</th>
                            <th>{{ $t('Capacity.utilization') }}</th>
                            <th>{{ $t('Capacity.status') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="u in (data ? data.users : [])" :key="u.userId">
                            <td class="cap-name" :title="u.name">{{ u.name }}</td>
                            <td>{{ r1(u.capacityHours) }}h</td>
                            <td>{{ r1(u.ptoHours) }}h</td>
                            <td>{{ r1(u.allocatedHours) }}h</td>
                            <td>
                                <div class="cap-util">
                                    <div class="cap-util-bar"><div class="cap-util-fill" :class="u.status" :style="{ width: Math.min(100, u.utilizationPct) + '%' }"></div></div>
                                    <span>{{ u.utilizationPct }}%</span>
                                </div>
                            </td>
                            <td><span class="cap-badge" :class="u.status">{{ $t('Capacity.s_' + u.status) }}</span></td>
                        </tr>
                        <tr v-if="data && !data.users.length"><td colspan="6" class="cap-empty">{{ $t('Capacity.no_members') }}</td></tr>
                        <tr v-if="!data"><td colspan="6" class="cap-empty">{{ $t('Capacity.loading') }}</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<script>
export default { name: 'CapacityPlanning' };
</script>

<script setup>
import { ref, computed, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// REP-06 — capacity planning / resource leveling. Capacity = working hours −
// approved PTO (reuses the SEC-08 engine, server-side); allocation = planned
// hours; over-allocated members are flagged. companyId-scoped.
const companyIdRef = inject('$companyId');
const cid = computed(() => (companyIdRef && companyIdRef.value) || companyIdRef || '');

const monthRange = () => {
    const n = new Date();
    return {
        f: new Date(Date.UTC(n.getFullYear(), n.getMonth(), 1)).toISOString().slice(0, 10),
        t: new Date(Date.UTC(n.getFullYear(), n.getMonth() + 1, 0)).toISOString().slice(0, 10),
    };
};
const mr = monthRange();
const from = ref(mr.f);
const to = ref(mr.t);
const hoursPerDay = ref(8);
const data = ref(null);

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

const load = async () => {
    try {
        const b = (await apiRequest('get', `${env.CAPACITY}?from=${from.value}&to=${to.value}&hoursPerDay=${hoursPerDay.value}`))?.data;
        data.value = (b && b.status) ? b.data : { totals: { users: 0, totalCapacity: 0, totalAllocated: 0, utilizationPct: 0, over: 0 }, users: [] };
    } catch (e) { data.value = { totals: { users: 0, totalCapacity: 0, totalAllocated: 0, utilizationPct: 0, over: 0 }, users: [] }; }
};

onMounted(load);
</script>

<style scoped>
.cap-wrap { display: flex; flex-direction: column; height: calc(100dvh - 46px); }
.cap-topbar { display: flex; align-items: center; gap: 14px; padding: 12px 20px; border-bottom: 1px solid #e6e7ee; flex-wrap: wrap; }
.cap-home img { width: 20px; height: 20px; }
.cap-title { font-size: 18px; margin: 0; }
.cap-controls { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.cap-controls .form-control { max-width: 160px; }
.cap-hpd { max-width: 70px !important; }
.cap-body { flex: 1; overflow-y: auto; padding: 18px 22px; }
.cap-totals { display: flex; flex-wrap: wrap; gap: 22px; background: #f7f8fc; border: 1px solid #e6e7ee; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; }
.cap-stat { display: flex; flex-direction: column; }
.cap-stat b { font-size: 20px; color: #3a3f52; }
.cap-stat span { font-size: 11.5px; color: #6b7280; }
.cap-stat.over b { color: #c0392b; }
.cap-table-wrap { overflow-x: auto; border: 1px solid #e6e7ee; border-radius: 8px; }
.cap-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.cap-table th { text-align: left; background: #f7f8fc; color: #3a3f52; font-weight: 700; padding: 9px 12px; border-bottom: 1px solid #e6e7ee; white-space: nowrap; }
.cap-table td { padding: 9px 12px; border-bottom: 1px solid #f0f1f6; color: #3a3f52; white-space: nowrap; }
.cap-name { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.cap-util { display: flex; align-items: center; gap: 8px; min-width: 140px; }
.cap-util-bar { flex: 1; height: 12px; background: #eef0f6; border-radius: 4px; overflow: hidden; }
.cap-util-fill { height: 100%; background: #2f3a8f; }
.cap-util-fill.full { background: #d99a00; }
.cap-util-fill.over { background: #c0392b; }
.cap-badge { font-size: 10.5px; font-weight: 700; border-radius: 5px; padding: 2px 7px; }
.cap-badge.under { background: #e7f6ee; color: #1c7a43; }
.cap-badge.full { background: #fff8e6; color: #9a6b00; }
.cap-badge.over { background: #fdecec; color: #c0392b; }
.cap-empty { text-align: center; color: #9aa0b4; padding: 20px; }
.cap-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 7px; padding: 8px 15px; font-size: 13px; cursor: pointer; }
</style>
