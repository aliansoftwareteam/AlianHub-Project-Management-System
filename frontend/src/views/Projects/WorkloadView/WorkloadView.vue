<template>
    <div v-if="!currentCompany?.planFeature?.workloadView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('conformationmsg.unlock_workload_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>

    <div v-else-if="isMobile" class="ah-page wv wv--mobile">
        <div class="ah-empty wv__mobile-card">
            <div class="wv__mobile-title">{{ $t('ViewsV2.desktop_only_title') }}</div>
            <p class="wv__mobile-text">{{ $t('ViewsV2.desktop_only_workload') }}</p>
        </div>
    </div>

    <div v-else class="ah-page wv">
        <div class="wv__bar">
            <RangePickerComp
                class="rangeComp wv__range"
                :class="{ 'disabled': isSpinner }"
                :isValidate="false"
                preSelectType="week"
                @SelectedDate="handleDate"
            />
            <div v-if="isEveryOne" class="wv__filter">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="filterOpen = !filterOpen">
                    {{ $t('Filters.filter_by') }}
                </button>
                <div v-if="filterOpen" class="ah-pop wv__pop ah-scroll">
                    <div class="ah-label ah-pop__label">{{ $t('UserTimesheet.Users') }}</div>
                    <label v-for="u in people" :key="u._id" class="ah-pop__item wv__pop-item">
                        <input type="checkbox" :value="u._id" v-model="selectedUserIds" />
                        <span>{{ u.Employee_Name }}</span>
                    </label>
                    <div v-if="teams.length" class="ah-pop__sep"></div>
                    <div v-if="teams.length" class="ah-label ah-pop__label">{{ $t('UserTimesheet.Teams') }}</div>
                    <button v-for="team in teams" :key="team._id" type="button" class="ah-pop__item" @click="addTeam(team)">
                        {{ team.name }}
                    </button>
                </div>
            </div>
            <span v-for="id in selectedUserIds" :key="id" class="ah-chip wv__chip">
                {{ nameOf(id) }}
                <button type="button" :aria-label="$t('ViewsV2.remove')" @click="selectedUserIds = selectedUserIds.filter((x) => x !== id)">×</button>
            </span>
            <div class="ah-toolbar__spacer"></div>
            <div class="ah-tabs wv__mode">
                <button type="button" class="ah-tab" :class="{ 'is-on': mode === 'estimate' }" @click="mode = 'estimate'">{{ $t('ViewsV2.by_estimate') }}</button>
                <button type="button" class="ah-tab" :class="{ 'is-on': mode === 'logged' }" @click="mode = 'logged'">{{ $t('ViewsV2.by_logged') }}</button>
            </div>
            <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="suggestBalance">
                <span class="wv__spark">✦</span> {{ $t('ViewsV2.balance') }}
            </button>
        </div>

        <div class="wv__body">
            <p v-if="error" class="ah-field__error wv__error">{{ error }}</p>
            <div class="wv__grid ah-scroll" :style="{ '--days': visibleDays.length || 10 }">
                <div class="wv__row wv__row--head">
                    <span></span>
                    <span v-for="d in visibleDays" :key="d" :class="{ 'is-today': d === today }">{{ dayHead(d) }}</span>
                    <span>{{ $t('ViewsV2.total') }}</span>
                </div>

                <div v-for="u in rows" :key="u.userId" class="wv__row">
                    <div class="wv__person">
                        <span class="ah-avatar wv__avatar">
                            <img v-if="u.avatar" :src="u.avatar" :alt="u.name" />
                            <template v-else>{{ initial(u.name) }}</template>
                        </span>
                        <div class="wv__person-text">
                            <div class="wv__name" :title="u.name">{{ u.name }}</div>
                            <div class="wv__sub" :class="{ 'is-over': u.utilizationPct > 100 }">{{ subLabel(u) }}</div>
                        </div>
                    </div>

                    <div
                        v-for="d in u.cells"
                        :key="d.date"
                        class="wv__cell"
                        :class="{ 'is-pto': d.pto, 'is-today': d.date === today, 'is-drop': dropKey === `${u.userId}|${d.date}` }"
                        @dragover.prevent="onDragOver(u, d)"
                        @dragleave="onDragLeave(u, d)"
                        @drop.prevent="onDrop(u, d)"
                    >
                        <span v-if="d.pto" class="wv__pto">{{ $t('ViewsV2.pto') }}</span>
                        <template v-else>
                            <div
                                v-if="value(d)"
                                class="wv__fill"
                                :class="{ 'is-over': isOver(d), 'is-tentative': isTentative(d.date) }"
                                :style="{ height: `${fillPct(d)}%` }"
                            >{{ hLabel(value(d)) }}</div>
                            <div v-if="mode === 'estimate' && d.chips.length" class="wv__chips">
                                <span
                                    v-for="c in d.chips.slice(0, 2)"
                                    :key="c.estimateId"
                                    class="wv__chip-task"
                                    draggable="true"
                                    :title="`${c.name} · ${hLabel(c.minutes)}`"
                                    @dragstart="onDragStart($event, u, d, c)"
                                    @dragend="onDragEnd"
                                    @click="openChip(c)"
                                >{{ c.name || c.taskId }}</span>
                                <span v-if="d.chips.length > 2" class="wv__chip-task wv__chip-task--more">+{{ d.chips.length - 2 }}</span>
                            </div>
                        </template>
                    </div>

                    <div class="wv__total" :class="{ 'is-over': u.utilizationPct > 100 }">
                        {{ hLabel(mode === 'estimate' ? u.totalEstimated : u.totalLogged) }}<small>/{{ Math.round(u.capacityMinutes / 60) }}</small>
                    </div>
                </div>

                <div v-if="!rows.length" class="ah-empty wv__empty">
                    {{ isSpinner ? $t('ViewsV2.loading') : $t('ViewsV2.workload_empty') }}
                </div>
            </div>

            <div class="wv__foot">
                <div class="wv__legend">
                    <span><i class="wv__key"></i>{{ mode === 'estimate' ? $t('ViewsV2.legend_estimated') : $t('ViewsV2.legend_logged') }}</span>
                    <span><i class="wv__key wv__key--tentative"></i>{{ $t('ViewsV2.legend_tentative') }}</span>
                    <span><i class="wv__key wv__key--over"></i>{{ $t('ViewsV2.legend_over') }}</span>
                </div>
                <div v-if="hint" class="wv__hint">
                    <span class="wv__spark">✦</span>
                    <span>{{ hint.text }}</span>
                    <button v-if="hint.apply" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="applyHint">
                        {{ $t('ViewsV2.apply') }}
                    </button>
                </div>
                <span v-else class="ah-muted wv__drag-hint">{{ $t('ViewsV2.drag_hint') }}</span>
            </div>
        </div>
        <SpinnerComp v-if="isSpinner" :is-spinner="isSpinner" />
    </div>
</template>

<script setup>
    import { onMounted, ref, computed, inject, watch } from "vue";
    import { useStore } from "vuex";
    import { useI18n } from "vue-i18n";
    import moment from 'moment';
    import '@vuepic/vue-datepicker/dist/main.css';
    import RangePickerComp from '@/components/molecules/RangePickerComp/RangePickerComp.vue';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import { useCustomComposable, useGetterFunctions } from '@/composable';
    import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
    import { apiRequest } from '../../../services';
    import * as env from '@/config/env';

    defineOptions({ name: "WorkloadView" });

    const props = defineProps({
        projectData: Object,
    })

    const { t } = useI18n();
    const { getters } = useStore();
    const { getUser } = useGetterFunctions();
    const { checkPermission, debouncerWithPromise } = useCustomComposable();
    const clientWidth = inject("$clientWidth");
    const currentUserId = inject('$userId');
    const companyId = inject('$companyId');

    const isSpinner = ref(false);
    const error = ref('');
    const users = ref([]);
    const days = ref([]);
    const dateRange = ref({});
    const selectedUserIds = ref([]);
    const filterOpen = ref(false);
    const mode = ref('estimate');
    const busy = ref(false);
    const drag = ref(null);
    const dropKey = ref('');
    const hint = ref(null);
    const isEveryOne = ref(false);

    const currentCompany = computed(() => getters["settings/selectedCompany"]);
    const teams = computed(() => getters["settings/teams"] || []);
    const isMobile = computed(() => Number(clientWidth?.value || 0) > 0 && Number(clientWidth.value) < 768);
    const today = computed(() => moment().format('YYYY-MM-DD'));
    const projectId = computed(() => String(props.projectData?._id || ''));

    const people = computed(() => {
        const all = getters["users/users"] || [];
        if (props.projectData?.isPrivateSpace === true) {
            return all.filter((u) => (props.projectData?.AssigneeUserId || []).includes(u._id));
        }
        return all;
    });

    const nameOf = (id) => getUser(id)?.Employee_Name || '';
    const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
    const dayHead = (d) => `${moment(d).format('dd').charAt(0)}${moment(d).format('D')}`;
    const hLabel = (minutes) => {
        const h = (Number(minutes) || 0) / 60;
        return `${h >= 10 || Number.isInteger(h) ? Math.round(h) : Math.round(h * 10) / 10}h`;
    };

    /* Capacity is the person's own working day (My settings → working hours) minus
     * approved PTO, so a 6h contract is not read as an under-loaded 8h one. */
    const hoursFor = (userId) => {
        const wh = getUser(userId)?.workingHours || {};
        const capacity = Number(wh.capacity);
        return Number.isFinite(capacity) && capacity > 0 ? capacity : 8;
    };
    const worksOn = (userId, date) => {
        const wh = getUser(userId)?.workingHours || {};
        const list = Array.isArray(wh.days) && wh.days.length ? wh.days.map(Number) : [1, 2, 3, 4, 5];
        return list.includes(moment(date).day());
    };

    // Weekends are dropped from the grid: an empty Sat/Sun column costs a tenth of
    // the width and says nothing.
    const visibleDays = computed(() => days.value.filter((d) => ![0, 6].includes(moment(d).day())));

    const rows = computed(() => users.value.map((u) => {
        const perDay = hoursFor(u.userId) * 60;
        const cells = (u.days || [])
            .filter((d) => visibleDays.value.includes(d.date))
            .map((d) => ({ ...d, capacityMinutes: d.pto || !worksOn(u.userId, d.date) ? 0 : perDay }));
        const capacityMinutes = cells.reduce((sum, d) => sum + d.capacityMinutes, 0);
        const totalEstimated = cells.reduce((sum, d) => sum + (d.estimated || 0), 0);
        const totalLogged = cells.reduce((sum, d) => sum + (d.logged || 0), 0);
        return {
            ...u,
            cells,
            capacityMinutes,
            totalEstimated,
            totalLogged,
            hoursPerDay: hoursFor(u.userId),
            utilizationPct: capacityMinutes > 0 ? Math.round((totalEstimated / capacityMinutes) * 100) : (totalEstimated > 0 ? 100 : 0),
        };
    }));

    const value = (d) => (mode.value === 'estimate' ? d.estimated : d.logged) || 0;
    const isOver = (d) => (d.capacityMinutes > 0 ? value(d) > d.capacityMinutes : value(d) > 0);
    const fillPct = (d) => (d.capacityMinutes > 0 ? Math.min(100, (value(d) / d.capacityMinutes) * 100) : (value(d) ? 100 : 0));
    const isTentative = (date) => moment(date).isAfter(moment().endOf('isoWeek'));
    const subLabel = (u) => {
        if (u.utilizationPct > 100) return t('ViewsV2.pct_period', { pct: u.utilizationPct });
        const pto = u.cells.filter((d) => d.pto);
        if (pto.length) {
            const range = pto.length === 1
                ? moment(pto[0].date).format('ddd')
                : `${moment(pto[0].date).format('ddd')}–${moment(pto[pto.length - 1].date).format('ddd')}`;
            return t('ViewsV2.pto_range', { range });
        }
        return t('ViewsV2.per_day', { h: u.hoursPerDay });
    };
    const pctAfter = (u, delta) => (u.capacityMinutes > 0 ? Math.round(((u.totalEstimated + delta) / u.capacityMinutes) * 100) : 0);

    const timeZone = computed(() => getUser(currentUserId?.value)?.Time_Zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

    const load = async () => {
        if (!dateRange.value.startDate || !dateRange.value.endDate || !projectId.value) return;
        isSpinner.value = true;
        error.value = '';
        try {
            const body = ((await apiRequest('post', env.WORKLOAD_GRID, {
                start: moment(dateRange.value.startDate).format('YYYY-MM-DD'),
                end: moment(dateRange.value.endDate).format('YYYY-MM-DD'),
                projectIds: [projectId.value],
                userIds: selectedUserIds.value,
                hoursPerDay: 8,
                timeZone: timeZone.value,
            })) || {}).data || {};
            if (!body.status) throw new Error(body.statusText || 'load_failed');
            users.value = body.data?.users || [];
            days.value = body.data?.days || [];
        } catch (e) {
            error.value = t('ViewsV2.load_failed');
            users.value = [];
        } finally {
            isSpinner.value = false;
        }
    };

    const handleDate = (modelData) => {
        dateRange.value.startDate = modelData.dateVal[0];
        dateRange.value.endDate = modelData.dateVal[1];
    };

    const addTeam = (team) => {
        const ids = Array.isArray(team.assigneeUsersArray) ? team.assigneeUsersArray.map(String) : [];
        selectedUserIds.value = [...new Set([...selectedUserIds.value, ...ids])];
        filterOpen.value = false;
    };

    const openChip = (chip) => {
        if (!chip?.taskId) return;
        openTask({
            companyId: companyId?.value,
            projectId: chip.projectId || projectId.value,
            sprintId: chip.sprintId || '',
            taskId: chip.taskId,
        });
    };

    const move = async ({ chip, fromUser, fromDay, toUser, toDay }) => {
        busy.value = true;
        error.value = '';
        try {
            const body = ((await apiRequest('post', env.WORKLOAD_MOVE, {
                taskId: chip.taskId,
                estimateId: chip.estimateId,
                fromUserId: fromUser.userId,
                toUserId: toUser.userId,
                fromDate: fromDay.date,
                toDate: toDay.date,
            })) || {}).data || {};
            if (!body.status) throw new Error(body.statusText || 'move_failed');
            hint.value = { text: t('ViewsV2.moved', { task: chip.name, name: toUser.name, day: moment(toDay.date).format('ddd D') }) };
            await load();
        } catch (e) {
            error.value = t('ViewsV2.move_failed');
        } finally {
            busy.value = false;
        }
    };

    const onDragStart = (event, u, d, chip) => {
        drag.value = { chip, fromUser: u, fromDay: d };
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', chip.taskId);
        }
    };
    const onDragOver = (u, d) => {
        if (!drag.value || d.pto) return;
        const key = `${u.userId}|${d.date}`;
        if (dropKey.value === key) return;
        dropKey.value = key;
        const { chip, fromUser } = drag.value;
        const same = fromUser.userId === u.userId;
        hint.value = {
            text: t('ViewsV2.dragging', {
                task: chip.name,
                h: hLabel(chip.minutes),
                name: u.name,
                day: moment(d.date).format('ddd'),
                from: fromUser.name,
                fromPct: pctAfter(fromUser, same ? 0 : -chip.minutes),
                toPct: pctAfter(u, same ? 0 : chip.minutes),
            }),
        };
    };
    const onDragLeave = (u, d) => { if (dropKey.value === `${u.userId}|${d.date}`) dropKey.value = ''; };
    const onDragEnd = () => { drag.value = null; dropKey.value = ''; if (hint.value && !hint.value.apply) hint.value = null; };
    const onDrop = (u, d) => {
        const current = drag.value;
        dropKey.value = '';
        drag.value = null;
        if (!current || d.pto) return;
        if (current.fromUser.userId === u.userId && current.fromDay.date === d.date) { hint.value = null; return; }
        move({ ...current, toUser: u, toDay: d });
    };

    const suggestBalance = () => {
        let worst = null;
        rows.value.forEach((u) => u.cells.forEach((d) => {
            if (!d.pto && d.chips.length && d.capacityMinutes > 0 && d.estimated > d.capacityMinutes
                && (!worst || d.estimated - d.capacityMinutes > worst.d.estimated - worst.d.capacityMinutes)) {
                worst = { u, d };
            }
        }));
        if (!worst) { hint.value = { text: t('ViewsV2.balance_none') }; return; }
        const chip = [...worst.d.chips].sort((a, b) => b.minutes - a.minutes)[0];
        let target = null;
        rows.value.forEach((u) => {
            if (u.userId === worst.u.userId) return;
            const d = u.cells.find((x) => x.date === worst.d.date);
            if (!d || d.pto || d.capacityMinutes <= 0) return;
            const room = d.capacityMinutes - d.estimated;
            if (room >= chip.minutes && (!target || room > target.room)) target = { u, d, room };
        });
        if (!target) { hint.value = { text: t('ViewsV2.balance_none') }; return; }
        hint.value = {
            text: t('ViewsV2.balance_hint', {
                task: chip.name,
                h: hLabel(chip.minutes),
                from: worst.u.name,
                day: moment(worst.d.date).format('ddd'),
                to: target.u.name,
                fromPct: pctAfter(worst.u, -chip.minutes),
                toPct: pctAfter(target.u, chip.minutes),
            }),
            apply: { chip, fromUser: worst.u, fromDay: worst.d, toUser: target.u, toDay: target.d },
        };
    };
    const applyHint = () => { if (hint.value && hint.value.apply && !busy.value) move(hint.value.apply); };

    watch([() => dateRange.value.startDate, () => dateRange.value.endDate, selectedUserIds, projectId], ([start, end]) => {
        if (!start || !end) return;
        debouncerWithPromise(400).then(() => load());
    });

    onMounted(() => {
        const permit = checkPermission('sheet_settings.workload_timesheet');
        isEveryOne.value = permit === true || permit === 2;
        if (!isEveryOne.value && currentUserId?.value) selectedUserIds.value = [String(currentUserId.value)];
        load();
    });
</script>

<style scoped src="./style.css"></style>
