<template>
    <div class="ph2">
        <div class="ph2__bar">
            <h1 class="ah-sr-only">{{ project?.ProjectName }}</h1>
            <select
                v-if="projects.length > 1"
                class="ph2__switch"
                :value="project?._id"
                :aria-label="$t('Projects.switch_project')"
                :title="$t('Projects.switch_project')"
                @change="$emit('select-project', $event.target.value)"
            >
                <option v-for="item in projects" :key="item._id" :value="item._id">{{ item.ProjectName }}</option>
            </select>
            <span v-else class="ph2__project" :title="project?.ProjectName">{{ project?.ProjectName }}</span>

            <div v-if="$slots.title" class="ph2__title-slot">
                <slot name="title"></slot>
            </div>
            <template v-else>
                <span class="ph2__swatch" :style="{ background: swatch }"></span>
                <button
                    type="button"
                    class="ph2__star"
                    :class="{ 'is-on': favourite }"
                    :aria-label="$t('Projects.favourite')"
                    :title="$t('Projects.favourite')"
                    @click="$emit('toggle-favourite')"
                >
                    <ShellIcon name="star" :size="14" />
                </button>
                <span v-if="project?.ProjectCode" class="ph2__code">{{ project.ProjectCode }}</span>
            </template>

            <span v-if="sprint?.name" class="ph2__crumb">
                <span class="ph2__sep">›</span>
                <span class="ph2__sprint">{{ sprint.name }}</span>
            </span>

            <span v-if="rangeLabel" class="ph2__range">{{ rangeLabel }}</span>

            <div class="ph2__actions">
                <div v-if="agentChip" class="ph2__agents" :title="$t('Projects.agents_chip_title')">
                    <span class="ph2__agents-dot"></span>
                    <span class="ph2__agents-label">{{ t('Projects.agents_working', { n: agentChip.agents }, agentChip.agents) }}</span>
                    <span class="ph2__agents-meta">{{ agentChip.meta }}</span>
                </div>
                <slot name="actions"></slot>
                <button v-if="showAiAssist" type="button" class="ah-btn ah-btn--sm ph2__ai" @click="$emit('ai-assist')">
                    <span aria-hidden="true">✦</span>{{ $t('Projects.ai_assist') }}
                </button>
                <button v-if="showAddTask" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="$emit('add-task')">+ {{ $t('Projects.task') }}</button>
            </div>
        </div>

        <div v-if="$slots.views" class="ph2__viewrow ah-scroll" @keydown="onViewsKeydown">
            <slot name="views"></slot>
        </div>
    </div>
</template>

<script setup>
/**
 * Project header — shared by every project view. Two rows: the breadcrumb bar
 * (name once, then the actions) and the view-tab row beneath it.
 *
 * Props
 *   project       Object   the project document (ProjectName, ProjectCode, projectIcon)
 *   projects      Array    the user's projects; two or more render the switcher (emits select-project(id))
 *   sprint        Object   { name, startDate, endDate } — the sprint in view, or null
 *   favourite     Boolean  star state
 *   agentSummary  Object   { agents, running, elapsedMs, spendUsd } from GET /api/v2/agents/runs — chip hidden when nothing runs
 *   showAiAssist / showAddTask   Boolean
 *
 * Emits
 *   ai-assist · add-task · toggle-favourite · select-project
 *
 * Slots
 *   title    replaces the swatch + star + code (Projects.vue passes its icon, inline rename and key)
 *   views    the view-tab row; its [role="tablist"] gets arrow/Home/End navigation from here
 *   actions  extra buttons, placed before AI Assist
 *
 * `+ Task` only emits; the host decides what it opens. Projects.vue bumps a
 * counter it provides as `addTaskRequest`, which the board watches to open its
 * first column's create row.
 */
import { computed, defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

const { t } = useI18n();

const props = defineProps({
    project: { type: Object, default: () => ({}) },
    projects: { type: Array, default: () => [] },
    sprint: { type: Object, default: null },
    favourite: { type: Boolean, default: false },
    agentSummary: { type: Object, default: null },
    showAiAssist: { type: Boolean, default: false },
    showAddTask: { type: Boolean, default: true }
});

defineEmits(['ai-assist', 'add-task', 'toggle-favourite', 'select-project']);

const PALETTE = ['#2F3990', '#2f9e7e', '#d98324', '#6b5ce7', '#0EA5E9', '#EC4899'];

const swatch = computed(() => {
    const icon = props.project?.projectIcon;
    if (icon?.type === 'color' && icon?.data) return icon.data;
    const hash = Array.from(String(props.project?.ProjectName || '')).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return PALETTE[hash % PALETTE.length];
});

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const rangeLabel = computed(() => {
    const s = props.sprint;
    if (!s?.startDate || !s?.endDate) return '';
    const start = new Date(s.startDate);
    const end = new Date(s.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
    const head = start.getMonth() === end.getMonth()
        ? `${MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}`
        : `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}`;
    const daysLeft = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
    return `${head} · ${t('Projects.days_left_short', { n: daysLeft })}`;
});

const agentChip = computed(() => {
    const s = props.agentSummary;
    if (!s || !Number(s.agents)) return null;
    const minutes = Math.max(0, Math.round(Number(s.elapsedMs || 0) / 60000));
    const spend = Number(s.spendUsd || 0);
    return { agents: Number(s.agents), meta: `${minutes}m · $${spend.toFixed(2)}` };
});

const TAB_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '];

/* Delegated from the row so a tab component only has to render role="tab".
   Manual activation (arrows move focus, Enter/Space commit) because activating
   a tab is a route change. Enter/Space are synthesised only for tabs that are
   not natively activatable, so a <button role="tab"> does not fire twice. */
const onViewsKeydown = (event) => {
    if (!TAB_KEYS.includes(event.key)) return;
    const tab = event.target.closest?.('[role="tab"]');
    const list = tab?.closest('[role="tablist"]');
    if (!tab || !list) return;

    if (event.key === 'Enter' || event.key === ' ') {
        if (tab.tagName === 'BUTTON' || tab.tagName === 'A') return;
        event.preventDefault();
        tab.click();
        return;
    }

    const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
    const from = tabs.indexOf(tab);
    if (from === -1) return;
    const to = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
            : (from + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;

    event.preventDefault();
    tabs.forEach((el) => { el.tabIndex = -1; });
    tabs[to].tabIndex = 0;
    tabs[to].focus();
};
</script>

<style>
@import "./project-header.css";
</style>
