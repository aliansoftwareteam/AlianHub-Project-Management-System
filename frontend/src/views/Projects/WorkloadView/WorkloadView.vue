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
            <div class="wv__mobile-title">{{ $t('Views.desktop_only_title') }}</div>
            <p class="wv__mobile-text">{{ $t('Views.desktop_only_workload') }}</p>
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
                <button type="button" :aria-label="$t('Views.remove')" @click="selectedUserIds = selectedUserIds.filter((x) => x !== id)">×</button>
            </span>
            <div class="ah-toolbar__spacer"></div>
            <div class="ah-tabs wv__mode" role="radiogroup" :aria-label="$t('Views.workload_unit')">
                <button
                    v-for="u in WORKLOAD_UNITS"
                    :key="u"
                    type="button"
                    class="ah-tab"
                    role="radio"
                    :aria-checked="unit === u"
                    :class="{ 'is-on': unit === u }"
                    @click="viewSettings.setWorkloadUnit(u)"
                >{{ $t(`Views.unit_${u}`) }}</button>
            </div>
            <div v-if="unit === 'hours'" class="ah-tabs wv__mode">
                <button type="button" class="ah-tab" :class="{ 'is-on': mode === 'estimate' }" @click="mode = 'estimate'">{{ $t('Views.by_estimate') }}</button>
                <button type="button" class="ah-tab" :class="{ 'is-on': mode === 'logged' }" @click="mode = 'logged'">{{ $t('Views.by_logged') }}</button>
            </div>
            <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="suggestBalance">
                <ShellIcon name="users" :size="13" class="wv__spark" /> {{ $t('Views.balance') }}
            </button>
        </div>

        <div class="wv__body">
            <p v-if="error" class="ah-field__error wv__error">{{ error }}</p>
            <div class="wv__grid ah-scroll" :style="{ '--days': visibleDays.length || 10 }">
                <div class="wv__row wv__row--head">
                    <span></span>
                    <span v-for="d in visibleDays" :key="d" :class="{ 'is-today': d === today }">{{ dayHead(d) }}</span>
                    <span>{{ $t('Views.total') }}</span>
                </div>

                <div v-for="u in rows" :key="u.userId" class="wv__row">
                    <div class="wv__person">
                        <span class="ah-avatar wv__avatar">
                            <AvatarImage :src="u.avatar" :alt="u.name">{{ initial(u.name) }}</AvatarImage>
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
                        :class="{ 'is-pto': d.off, 'is-today': d.date === today, 'is-drop': dropKey === `${u.userId}|${d.date}` }"
                        @dragover.prevent="onDragOver(u, d)"
                        @dragleave="onDragLeave(u, d)"
                        @drop.prevent="onDrop(u, d)"
                    >
                        <span v-if="d.off" class="wv__pto">{{ d.pto ? $t('Views.pto') : $t('Views.unavailable') }}</span>
                        <template v-else>
                            <div
                                v-if="value(d)"
                                class="wv__fill"
                                :class="{ 'is-over': isOver(d), 'is-tentative': isTentative(d.date) }"
                                :style="{ height: `${fillPct(d)}%` }"
                            >{{ amountLabel(value(d)) }}</div>
                            <div v-if="(gridUnit !== 'hours' || mode === 'estimate') && d.chips.length" class="wv__chips">
                                <span
                                    v-for="c in d.chips.slice(0, 2)"
                                    :key="c.estimateId || c.taskId"
                                    class="wv__chip-task"
                                    draggable="true"
                                    :title="`${c.name} · ${amountLabel(size(c))}`"
                                    @dragstart="onDragStart($event, u, d, c)"
                                    @dragend="onDragEnd"
                                    @click="openChip(c)"
                                >{{ c.name || c.taskId }}</span>
                                <span v-if="d.chips.length > 2" class="wv__chip-task wv__chip-task--more">+{{ d.chips.length - 2 }}</span>
                            </div>
                        </template>
                    </div>

                    <div class="wv__total" :class="{ 'is-over': u.utilizationPct > 100 }">
                        {{ amountLabel(u.total) }}<small>/{{ capacityLabel(u.capacity) }}</small>
                    </div>
                </div>

                <div v-if="!rows.length" class="ah-empty wv__empty">
                    {{ isSpinner ? $t('Views.loading') : (gridUnit === 'hours' ? $t('Views.workload_empty') : $t('Views.workload_empty_tasks')) }}
                </div>
            </div>

            <div class="wv__foot">
                <div class="wv__legend">
                    <span><i class="wv__key"></i>{{ legendLabel }}</span>
                    <span><i class="wv__key wv__key--tentative"></i>{{ $t('Views.legend_tentative') }}</span>
                    <span><i class="wv__key wv__key--over"></i>{{ $t('Views.legend_over') }}</span>
                    <span v-if="gridUnit === 'points' && unpointed" class="wv__unpointed">{{ $t('Views.unpointed_note', { n: unpointed }, unpointed) }}</span>
                </div>
                <div v-if="hint" class="wv__hint">
                    <ShellIcon name="info" :size="13" class="wv__spark" />
                    <span>{{ hint.text }}</span>
                    <button v-if="hint.apply" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="applyHint">
                        {{ $t('Views.apply') }}
                    </button>
                </div>
                <span v-else class="ah-muted wv__drag-hint">{{ $t('Views.drag_hint') }}</span>
            </div>
        </div>
        <SpinnerComp v-if="isSpinner" :is-spinner="isSpinner" />
    </div>
</template>

<script setup>
    import { onMounted, ref, computed, inject, watch } from "vue";
    import AvatarImage from "@/components/atom/AvatarImage/AvatarImage.vue";
    import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
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
    import { useViewSettings } from '@/views/Projects/composables/viewSettingsContext';
    import { WORKLOAD_UNITS, cellLoad, chipSize, dailyCapacity, gridWeek, plannedLoad, roundAmount, workingDaysOnly } from './workloadUnits';

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
    const answeredWeek = ref(null);
    const dateRange = ref({});
    const selectedUserIds = ref([]);
    const filterOpen = ref(false);
    const mode = ref('estimate');
    const busy = ref(false);
    const drag = ref(null);
    const dropKey = ref('');
    const hint = ref(null);
    const isEveryOne = ref(false);
    const unpointed = ref(0);
    const gridUnit = ref('hours');
    const viewSettings = useViewSettings();
    const unit = computed(() => (WORKLOAD_UNITS.includes(viewSettings.workloadUnit?.value) ? viewSettings.workloadUnit.value : 'hours'));

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
    const amountLabel = (amount) => {
        const n = roundAmount(amount);
        if (gridUnit.value === 'points') return t('Views.points_short', { n }, n);
        if (gridUnit.value === 'count') return t('Views.tasks_short', { n }, n);
        return hLabel(amount);
    };
    const capacityLabel = (capacity) => (gridUnit.value === 'hours' ? Math.round(capacity / 60) : roundAmount(capacity));
    const legendLabel = computed(() => {
        if (gridUnit.value === 'points') return t('Views.legend_points');
        if (gridUnit.value === 'count') return t('Views.legend_tasks');
        return mode.value === 'estimate' ? t('Views.legend_estimated') : t('Views.legend_logged');
    });

    /* Capacity is the person's own working day (My settings → working hours) minus
     * approved PTO, so a 6h contract is not read as an under-loaded 8h one. */
    const hoursFor = (userId) => {
        const wh = getUser(userId)?.workingHours || {};
        const capacity = Number(wh.capacity);
        return Number.isFinite(capacity) && capacity > 0 ? capacity : 8;
    };
    const week = computed(() => gridWeek(answeredWeek.value, currentCompany.value, props.projectData));
    const workDaysOf = (userId) => {
        const wh = getUser(userId)?.workingHours || {};
        return Array.isArray(wh.days) && wh.days.length ? wh.days.map(Number) : week.value;
    };
    const worksOn = (userId, date) => workDaysOf(userId).includes(moment(date).day());

    const visibleDays = computed(() => workingDaysOnly(days.value, week.value));

    const value = (d) => cellLoad(gridUnit.value, mode.value, d);
    const planned = (d) => plannedLoad(gridUnit.value, d);
    const size = (chip) => chipSize(gridUnit.value, chip);

    /* The server names time off as PTO to the person and to owners and admins, and as unavailable to anyone else. */
    const isOff = (d) => Boolean(d.pto || d.unavailable);

    const rows = computed(() => users.value.map((u) => {
        const perDay = dailyCapacity({ unit: gridUnit.value, hoursPerDay: hoursFor(u.userId), rule: u.capacityRule, workDays: workDaysOf(u.userId).length });
        const cells = (u.days || [])
            .filter((d) => visibleDays.value.includes(d.date))
            .map((d) => ({ ...d, off: isOff(d), chips: d.chips || [], capacity: isOff(d) || !worksOn(u.userId, d.date) ? 0 : perDay }));
        const capacity = cells.reduce((sum, d) => sum + d.capacity, 0);
        const total = cells.reduce((sum, d) => sum + value(d), 0);
        const plannedTotal = cells.reduce((sum, d) => sum + planned(d), 0);
        return {
            ...u,
            cells,
            capacity,
            total,
            plannedTotal,
            hoursPerDay: hoursFor(u.userId),
            utilizationPct: capacity > 0 ? Math.round((plannedTotal / capacity) * 100) : (plannedTotal > 0 ? 100 : 0),
        };
    }));

    const isOver = (d) => (d.capacity > 0 ? value(d) > d.capacity : value(d) > 0);
    const fillPct = (d) => (d.capacity > 0 ? Math.min(100, (value(d) / d.capacity) * 100) : (value(d) ? 100 : 0));
    const isTentative = (date) => moment(date).isAfter(moment().endOf('isoWeek'));
    const capacityRuleLabel = (u) => {
        const rule = u.capacityRule || {};
        const key = `Views.${gridUnit.value === 'points' ? 'points' : 'tasks'}_per_${rule.per === 'day' ? 'day' : 'week'}`;
        return t(key, { n: roundAmount(rule.value) });
    };
    const subLabel = (u) => {
        if (u.utilizationPct > 100) return t('Views.pct_period', { pct: u.utilizationPct });
        const off = u.cells.filter((d) => d.off);
        if (off.length) {
            const range = off.length === 1
                ? moment(off[0].date).format('ddd')
                : `${moment(off[0].date).format('ddd')}–${moment(off[off.length - 1].date).format('ddd')}`;
            return t(off.every((d) => d.pto) ? 'Views.pto_range' : 'Views.unavailable_range', { range });
        }
        return gridUnit.value === 'hours' ? t('Views.per_day', { h: u.hoursPerDay }) : capacityRuleLabel(u);
    };
    const pctAfter = (u, delta) => (u.capacity > 0 ? Math.round(((u.plannedTotal + delta) / u.capacity) * 100) : 0);

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
                unit: unit.value,
            })) || {}).data || {};
            if (!body.status) throw new Error(body.statusText || 'load_failed');
            users.value = body.data?.users || [];
            days.value = body.data?.days || [];
            answeredWeek.value = body.data?.workingDays || null;
            gridUnit.value = WORKLOAD_UNITS.includes(body.data?.unit) ? body.data.unit : 'hours';
            unpointed.value = Number(body.data?.unpointed) || 0;
        } catch (e) {
            error.value = t('Views.load_failed');
            users.value = [];
            unpointed.value = 0;
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
            hint.value = { text: t('Views.moved', { task: chip.name, name: toUser.name, day: moment(toDay.date).format('ddd D') }) };
            await load();
        } catch (e) {
            error.value = t('Views.move_failed');
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
        if (!drag.value || d.off) return;
        const key = `${u.userId}|${d.date}`;
        if (dropKey.value === key) return;
        dropKey.value = key;
        const { chip, fromUser } = drag.value;
        const same = fromUser.userId === u.userId;
        hint.value = {
            text: t('Views.dragging', {
                task: chip.name,
                h: amountLabel(size(chip)),
                name: u.name,
                day: moment(d.date).format('ddd'),
                from: fromUser.name,
                fromPct: pctAfter(fromUser, same ? 0 : -size(chip)),
                toPct: pctAfter(u, same ? 0 : size(chip)),
            }),
        };
    };
    const onDragLeave = (u, d) => { if (dropKey.value === `${u.userId}|${d.date}`) dropKey.value = ''; };
    const onDragEnd = () => { drag.value = null; dropKey.value = ''; if (hint.value && !hint.value.apply) hint.value = null; };
    const onDrop = (u, d) => {
        const current = drag.value;
        dropKey.value = '';
        drag.value = null;
        if (!current || d.off) return;
        if (current.fromUser.userId === u.userId && current.fromDay.date === d.date) { hint.value = null; return; }
        move({ ...current, toUser: u, toDay: d });
    };

    const suggestBalance = () => {
        let worst = null;
        rows.value.forEach((u) => u.cells.forEach((d) => {
            if (!d.off && d.chips.length && d.capacity > 0 && planned(d) > d.capacity
                && (!worst || planned(d) - d.capacity > planned(worst.d) - worst.d.capacity)) {
                worst = { u, d };
            }
        }));
        if (!worst) { hint.value = { text: t('Views.balance_none') }; return; }
        const chip = [...worst.d.chips].sort((a, b) => size(b) - size(a))[0];
        let target = null;
        rows.value.forEach((u) => {
            if (u.userId === worst.u.userId) return;
            const d = u.cells.find((x) => x.date === worst.d.date);
            if (!d || d.off || d.capacity <= 0) return;
            const room = d.capacity - planned(d);
            if (room >= size(chip) && (!target || room > target.room)) target = { u, d, room };
        });
        if (!target) { hint.value = { text: t('Views.balance_none') }; return; }
        hint.value = {
            text: t('Views.balance_hint', {
                task: chip.name,
                h: amountLabel(size(chip)),
                from: worst.u.name,
                day: moment(worst.d.date).format('ddd'),
                to: target.u.name,
                fromPct: pctAfter(worst.u, -size(chip)),
                toPct: pctAfter(target.u, size(chip)),
            }),
            apply: { chip, fromUser: worst.u, fromDay: worst.d, toUser: target.u, toDay: target.d },
        };
    };
    const applyHint = () => { if (hint.value && hint.value.apply && !busy.value) move(hint.value.apply); };

    watch([() => dateRange.value.startDate, () => dateRange.value.endDate, selectedUserIds, projectId, unit], ([start, end]) => {
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
