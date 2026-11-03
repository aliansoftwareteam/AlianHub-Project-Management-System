<template>
    <div class="rpt__date">
        <button v-if="steppable" type="button" class="rpt__step" :aria-label="$t('Reports.range_previous')" data-test="report-range-prev" @click="$emit('step', -1)">
            <ShellIcon name="chevronLeft" :size="13" aria-hidden="true" />
        </button>
        <div ref="anchor" class="evr__chip-anchor">
            <button
                type="button"
                class="evr__chip is-on"
                aria-haspopup="dialog"
                :aria-expanded="open ? 'true' : 'false'"
                data-test="report-range"
                @click="toggle"
            >
                <ShellIcon name="calendar" :size="13" aria-hidden="true" />
                <span>{{ presetLabel }}</span>
                <span v-if="steppable" class="rpt__range-text">{{ rangeText }}</span>
                <ShellIcon name="chevronDown" :size="12" aria-hidden="true" />
            </button>
            <div v-if="open" class="ah-pop evr__pop rpt__date-pop" role="dialog" :aria-label="$t('Reports.date_range')">
                <div class="rpt__presets" :class="{ 'is-single': single }">
                    <button
                        v-for="preset in quickPresets"
                        :key="preset"
                        type="button"
                        class="ah-pop__item"
                        :class="{ 'is-active': preset === filters.preset }"
                        :aria-pressed="preset === filters.preset ? 'true' : 'false'"
                        :data-test="`report-preset-${preset}`"
                        @click="pick(preset)"
                    >{{ $t(`Reports.preset_${preset}`) }}</button>
                </div>
                <div class="rpt__custom" data-test="report-custom">
                    <span class="rpt__custom-hint">{{ single ? $t('Reports.pick_day') : $t('Reports.pick_range') }}</span>
                    <VueDatePicker
                        :model-value="draft"
                        inline
                        auto-apply
                        :range="!single"
                        :partial-range="false"
                        :enable-time-picker="false"
                        :week-start="1"
                        model-type="yyyy-MM-dd"
                        :month-change-on-scroll="false"
                        @update:model-value="applyCustom"
                    />
                </div>
            </div>
        </div>
        <button v-if="steppable" type="button" class="rpt__step" :aria-label="$t('Reports.range_next')" data-test="report-range-next" @click="$emit('step', 1)">
            <ShellIcon name="chevronRight" :size="13" aria-hidden="true" />
        </button>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import moment from 'moment';
import { useI18n } from 'vue-i18n';
import VueDatePicker from '@vuepic/vue-datepicker';
import '@vuepic/vue-datepicker/dist/main.css';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

defineOptions({ name: 'ReportDateChip' });

const props = defineProps({
    filters: { type: Object, required: true },
    presets: { type: Array, required: true },
});
const emit = defineEmits(['apply', 'step']);
const { t } = useI18n();

const anchor = ref(null);
const open = ref(false);
const draft = ref(null);

const single = computed(() => !props.presets.some((preset) => !['today', 'yesterday', 'custom'].includes(preset)));
const quickPresets = computed(() => props.presets.filter((preset) => preset !== 'custom'));
const steppable = computed(() => props.filters.preset !== 'all_time');
const presetLabel = computed(() => t(`Reports.preset_${props.filters.preset}`));
const rangeText = computed(() => {
    const start = moment(props.filters.start);
    const end = moment(props.filters.end);
    if (!start.isValid()) return '';
    if (start.isSame(end, 'day')) return start.format('ddd, MMM D YYYY');
    const sameYear = start.isSame(end, 'year');
    return `${start.format(sameYear ? 'MMM D' : 'MMM D YYYY')} – ${end.format('MMM D YYYY')}`;
});

const toggle = () => {
    draft.value = single.value ? props.filters.start : [props.filters.start, props.filters.end];
    open.value = !open.value;
};
const pick = (preset) => {
    open.value = false;
    emit('apply', { preset });
};
/* The calendar answers once a day (or both ends of a range) is picked. */
const applyCustom = (value) => {
    const [start, end] = Array.isArray(value) ? value : [value, value];
    if (!start) return;
    open.value = false;
    emit('apply', { preset: 'custom', start, end: end || start });
};

const onOutside = (event) => { if (anchor.value && !anchor.value.contains(event.target)) open.value = false; };
const onEscape = (event) => { if (event.key === 'Escape') open.value = false; };
const listen = (on) => {
    document[on ? 'addEventListener' : 'removeEventListener']('click', onOutside);
    document[on ? 'addEventListener' : 'removeEventListener']('keydown', onEscape);
};
watch(open, listen);
onBeforeUnmount(() => listen(false));
</script>
