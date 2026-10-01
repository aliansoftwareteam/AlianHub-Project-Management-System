<template>
    <span v-if="split && split.label" class="sb" :class="`sb--${split.label}`" :title="tooltip" data-test="split-badge">
        <span class="sb__mark" aria-hidden="true">{{ mark }}</span>
        <span class="sb__text">{{ text }}</span>
    </span>
</template>

<script setup>
import { computed, defineProps } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
    split: { type: Object, default: null },
});

const { t, te } = useI18n();

const needText = (need) => {
    if (!need) return '';
    const key = `Ai.req_${need}`;
    return te(key) ? t(key) : String(need).replace(/_/g, ' ');
};

const text = computed(() => {
    const s = props.split || {};
    if (s.label === 'agent') return s.skill ? `${t('AiProject.split_agent')} · ${s.skill}` : t('AiProject.split_agent');
    if (s.label === 'agent-after') return t('AiProject.split_agent_after', { need: needText(s.need) });
    return s.reason ? `${t('AiProject.split_person')} — ${s.reason}` : t('AiProject.split_person');
});

const tooltip = computed(() => (props.split && props.split.reason) || '');

const mark = computed(() => {
    const label = props.split && props.split.label;
    if (label === 'agent') return '⚡';
    if (label === 'agent-after') return '⏳';
    return '👤';
});
</script>

<style scoped>
.sb {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.5;
    border: 1px solid transparent;
}
.sb__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb--agent { background: var(--brand-tint); color: var(--brand); border-color: var(--brand-border); }
.sb--agent-after { background: var(--warn-bg); color: var(--warn-ink); border-color: var(--warn); }
.sb--person { background: var(--fill); color: var(--ink-2); border-color: var(--hairline); }
</style>
