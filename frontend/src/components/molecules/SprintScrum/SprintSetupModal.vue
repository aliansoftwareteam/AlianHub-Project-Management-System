<template>
    <!-- Teleported for the same reason ConfirmDelete is: no ancestor overflow or
         stacking context can clip it. That puts it outside #app, which owns the
         app font, so the font is set explicitly below. -->
    <Teleport to="body">
        <div class="ssm__wrap" @click.self="$emit('close')">
            <div class="ssm" role="dialog" aria-modal="true" :aria-label="$t('Scrum.sprint_settings')">
                <div class="ssm__head">
                    <h3 class="ssm__title">{{ $t('Scrum.sprint_settings') }}</h3>
                    <span class="ssm__sub">{{ sprintName }}</span>
                </div>

                <label class="ssm__toggle">
                    <input type="checkbox" v-model="isScrum" />
                    <span>
                        <strong>{{ $t('Scrum.run_as_sprint') }}</strong>
                        <em>{{ $t('Scrum.run_as_sprint_hint') }}</em>
                    </span>
                </label>

                <div v-if="isScrum" class="ssm__body">
                    <label class="ssm__field">
                        <span class="ssm__label">{{ $t('Scrum.goal') }}</span>
                        <input
                            v-model="goal"
                            type="text"
                            class="ssm__input"
                            maxlength="500"
                            :placeholder="$t('Scrum.goal_placeholder')"
                        />
                    </label>

                    <div class="ssm__row">
                        <label class="ssm__field">
                            <span class="ssm__label">{{ $t('Scrum.start_date') }}</span>
                            <input v-model="startDate" type="date" class="ssm__input" />
                        </label>

                        <label class="ssm__field">
                            <span class="ssm__label">{{ $t('Scrum.duration') }}</span>
                            <select v-model="durationDays" class="ssm__input">
                                <option v-for="option in DURATIONS" :key="option.days" :value="option.days">
                                    {{ $t(option.label) }}
                                </option>
                            </select>
                        </label>
                    </div>

                    <label class="ssm__field">
                        <span class="ssm__label">{{ $t('Scrum.end_date') }}</span>
                        <input
                            v-model="endDate"
                            type="date"
                            class="ssm__input"
                            :disabled="durationDays !== CUSTOM"
                        />
                        <!-- A preset derives the end date, so showing it read-only is
                             the honest version of "2 weeks": people plan against the
                             actual last day, not the word. -->
                        <em v-if="durationDays !== CUSTOM" class="ssm__hint">{{ $t('Scrum.end_from_duration') }}</em>
                    </label>

                    <p v-if="problem" class="ssm__problem">{{ problem }}</p>
                </div>

                <div class="ssm__actions">
                    <button type="button" class="ssm__btn" @click="$emit('close')">{{ $t('Projects.cancel') }}</button>
                    <button type="button" class="ssm__btn ssm__btn--primary" :disabled="busy || !!problem" @click="save">
                        {{ busy ? '…' : $t('Scrum.save') }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script>
export default { name: 'SprintSetupModal' };
</script>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';

const props = defineProps({
    sprint: { type: Object, required: true },
});
const emit = defineEmits(['close', 'saved']);

const { t } = useI18n();
const $toast = useToast();

const CUSTOM = 0;
const DURATIONS = [
    { days: 7, label: 'Scrum.one_week' },
    { days: 14, label: 'Scrum.two_weeks' },
    { days: 21, label: 'Scrum.three_weeks' },
    { days: 28, label: 'Scrum.four_weeks' },
    { days: CUSTOM, label: 'Scrum.custom' },
];

const sprintName = computed(() => props.sprint?.name || '');

// <input type="date"> speaks YYYY-MM-DD in the viewer's own calendar, which is
// what a sprint box means. Going through toISOString() would shift the day for
// anyone east or west of UTC.
const toInputDate = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fromInputDate = (value, endOfDay) => {
    if (!value) return null;
    const [y, m, d] = String(value).split('-').map(Number);
    if (!y || !m || !d) return null;
    return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
};

const addDays = (value, days) => {
    const d = new Date(value);
    d.setDate(d.getDate() + days);
    return d;
};

const isScrum = ref(props.sprint?.isScrum === true);
const goal = ref(props.sprint?.goal || '');
const startDate = ref(toInputDate(props.sprint?.startDate) || toInputDate(new Date()));
const endDate = ref(toInputDate(props.sprint?.endDate));
const busy = ref(false);

// An existing sprint whose box matches a preset reopens on that preset rather
// than as "Custom".
const initialDuration = () => {
    const from = fromInputDate(startDate.value);
    const to = fromInputDate(endDate.value);
    if (!from || !to) return 7;
    const span = Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()) - from) / 86400000) + 1;
    return DURATIONS.some((option) => option.days === span) ? span : CUSTOM;
};
const durationDays = ref(props.sprint?.endDate ? initialDuration() : 7);

const applyDuration = () => {
    if (durationDays.value === CUSTOM) return;
    const from = fromInputDate(startDate.value);
    if (!from) return;
    endDate.value = toInputDate(addDays(from, durationDays.value - 1));
};

watch([startDate, durationDays], applyDuration, { immediate: true });

const problem = computed(() => {
    if (!isScrum.value) return '';
    if (!startDate.value || !endDate.value) return t('Scrum.need_both_dates');
    const from = fromInputDate(startDate.value);
    const to = fromInputDate(endDate.value, true);
    if (!from || !to) return t('Scrum.dates_unreadable');
    if (to.getTime() <= from.getTime()) return t('Scrum.end_after_start');
    return '';
});

const save = async () => {
    if (busy.value) return;
    busy.value = true;
    try {
        const body = isScrum.value
            ? {
                sprintId: props.sprint.id || props.sprint._id,
                isScrum: true,
                goal: goal.value,
                startDate: fromInputDate(startDate.value),
                endDate: fromInputDate(endDate.value, true),
            }
            : { sprintId: props.sprint.id || props.sprint._id, isScrum: false };

        const res = await apiRequest('post', '/api/v2/sprints/scrum', body);
        if (!res?.data?.status) {
            $toast.error(res?.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            busy.value = false;
            return;
        }
        $toast.success(t('Scrum.sprint_saved'), { position: 'top-right' });
        emit('saved', res.data.data);
        emit('close');
    } catch (error) {
        $toast.error(error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
        busy.value = false;
    }
};

const onKey = (e) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<style scoped>
.ssm__wrap {
    position: fixed;
    inset: 0;
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(17, 20, 33, .45);
    font-family: Roboto, -apple-system, "Segoe UI", sans-serif;
}
.ssm {
    width: 100%;
    max-width: 460px;
    max-height: 90vh;
    overflow-y: auto;
    background: #fff;
    border-radius: 12px;
    padding: 22px;
    box-shadow: 0 18px 48px rgba(17, 20, 33, .22);
}
.ssm__head { margin-bottom: 18px; }
.ssm__title { margin: 0; font-size: 17px; font-weight: 600; color: #1f2333; }
.ssm__sub { display: block; margin-top: 3px; font-size: 13px; color: #6b7280; }

.ssm__toggle { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
.ssm__toggle input { margin-top: 3px; }
.ssm__toggle strong { display: block; font-size: 13.5px; font-weight: 500; color: #1f2333; }
.ssm__toggle em { display: block; margin-top: 2px; font-size: 12px; font-style: normal; color: #6b7280; line-height: 1.45; }

.ssm__body { margin-top: 18px; display: flex; flex-direction: column; gap: 14px; }
.ssm__row { display: flex; gap: 12px; }
.ssm__row .ssm__field { flex: 1; min-width: 0; }
.ssm__field { display: block; }
.ssm__label { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 500; color: #4b5162; }
.ssm__input {
    width: 100%;
    height: 38px;
    padding: 0 10px;
    font-family: inherit;
    font-size: 13.5px;
    color: #1f2333;
    background: #fff;
    border: 1px solid #dfe1ec;
    border-radius: 8px;
    outline: none;
}
.ssm__input:focus { border-color: #2f3a8f; }
.ssm__input:disabled { background: #f5f6fa; color: #6b7280; }
.ssm__hint { display: block; margin-top: 5px; font-size: 11.5px; font-style: normal; color: #8b90a0; }
.ssm__problem { margin: 0; font-size: 12.5px; color: #b02a2a; }

.ssm__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.ssm__btn {
    border: 1px solid #dfe1ec;
    background: #fff;
    color: #1f2333;
    font-family: inherit;
    font-size: 13px;
    padding: 9px 18px;
    border-radius: 8px;
    cursor: pointer;
}
.ssm__btn:hover { background: #f5f6fa; }
.ssm__btn--primary { background: #2f3a8f; border-color: #2f3a8f; color: #fff; }
.ssm__btn--primary:hover:not(:disabled) { background: #26307a; }
.ssm__btn:disabled { opacity: .55; cursor: default; }
</style>
