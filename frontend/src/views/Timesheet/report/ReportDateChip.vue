<template>
    <div class="rpt__date">
        <button type="button" class="rpt__step" :aria-label="$t('Reports.range_previous')" data-test="report-range-prev" @click="$emit('step', -1)">
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
                <span class="rpt__range-text">{{ rangeText }}</span>
                <ShellIcon name="chevronDown" :size="12" aria-hidden="true" />
            </button>
            <div v-if="open" class="ah-pop evr__pop rpt__date-pop" role="dialog" :aria-label="$t('Reports.date_range')">
                <div class="rpt__presets">
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
                <form class="rpt__custom" data-test="report-custom" @submit.prevent="applyCustom">
                    <label class="ah-field">
                        <span class="ah-field__label">{{ single ? $t('Reports.day') : $t('Reports.from') }}</span>
                        <input v-model="draftStart" type="date" class="ah-input rpt__date-input" required data-test="report-from" />
                    </label>
                    <label v-if="!single" class="ah-field">
                        <span class="ah-field__label">{{ $t('Reports.to') }}</span>
                        <input v-model="draftEnd" type="date" class="ah-input rpt__date-input" required data-test="report-to" />
                    </label>
                    <div class="rpt__custom-actions">
                        <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-test="report-custom-apply">{{ $t('Reports.apply_range') }}</button>
                    </div>
                </form>
            </div>
        </div>
        <button type="button" class="rpt__step" :aria-label="$t('Reports.range_next')" data-test="report-range-next" @click="$emit('step', 1)">
            <ShellIcon name="chevronRight" :size="13" aria-hidden="true" />
        </button>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import moment from 'moment';
import { useI18n } from 'vue-i18n';
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
const draftStart = ref('');
const draftEnd = ref('');

const single = computed(() => !props.presets.some((preset) => !['today', 'yesterday', 'custom'].includes(preset)));
const quickPresets = computed(() => props.presets.filter((preset) => preset !== 'custom'));
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
    draftStart.value = props.filters.start;
    draftEnd.value = props.filters.end;
    open.value = !open.value;
};
const pick = (preset) => {
    open.value = false;
    emit('apply', { preset });
};
const applyCustom = () => {
    if (!draftStart.value) return;
    open.value = false;
    emit('apply', { preset: 'custom', start: draftStart.value, end: single.value ? draftStart.value : (draftEnd.value || draftStart.value) });
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
