<template>
    <div class="ph2">
        <div class="ph2__bar">
            <button v-if="showBack" type="button" class="ph2__back" :aria-label="$t('ProjectsV2.back')" @click="$emit('back')">
                <ShellIcon name="chevron" :size="16" />
            </button>

            <select
                v-if="projects.length > 1"
                class="ph2__switch"
                :value="project?._id"
                :aria-label="$t('ProjectsV2.title')"
                :title="$t('ProjectsV2.title')"
                @change="$emit('select-project', $event.target.value)"
            >
                <option v-for="item in projects" :key="item._id" :value="item._id">{{ item.ProjectName }}</option>
            </select>

            <div v-if="$slots.title" class="ph2__title-slot">
                <slot name="title"></slot>
            </div>
            <template v-else>
                <span class="ph2__swatch" :style="{ background: swatch }"></span>
                <span class="ph2__project" :title="project?.ProjectName">{{ project?.ProjectName }}</span>
                <button
                    type="button"
                    class="ph2__star"
                    :class="{ 'is-on': favourite }"
                    :aria-label="$t('ProjectsV2.favourite')"
                    :title="$t('ProjectsV2.favourite')"
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

            <div class="ph2__views ah-scroll">
                <slot name="views">
                    <button
                        v-for="view in views"
                        :key="view.keyName || view.id"
                        type="button"
                        class="ph2__tab"
                        :class="{ 'is-active': activeView === view.keyName }"
                        @click="$emit('select-view', view.keyName)"
                    >{{ viewLabel(view) }}</button>
                    <button v-if="canAddView" type="button" class="ph2__tab ph2__tab--add" @click="$emit('add-view')">+ {{ $t('ProjectsV2.view') }}</button>
                </slot>
            </div>

            <div class="ph2__actions">
                <div v-if="agentChip" class="ph2__agents" :title="$t('ProjectsV2.agents_chip_title')">
                    <span class="ph2__agents-dot"></span>
                    <span class="ph2__agents-label">{{ $t('ProjectsV2.agents_working', { n: agentChip.agents }) }}</span>
                    <span class="ph2__agents-meta">{{ agentChip.meta }}</span>
                </div>
                <slot name="actions"></slot>
                <button v-if="showFilter" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('filter')">{{ $t('ProjectsV2.filter') }}</button>
                <button v-if="showAiAssist" type="button" class="ah-btn ah-btn--sm ph2__ai" @click="$emit('ai-assist')">
                    <span aria-hidden="true">✦</span>{{ $t('ProjectsV2.ai_assist') }}
                </button>
                <button v-if="showAddTask" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="$emit('add-task')">+ {{ $t('ProjectsV2.task') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
/**
 * Project header + views bar — handoff 10b, shared by every project view.
 *
 * Props
 *   project       Object   the project document (ProjectName, ProjectCode, projectIcon)
 *   projects      Array    the user's projects; two or more render the switcher (emits select-project(id))
 *   sprint        Object   { name, startDate, endDate } — the sprint in view, or null
 *   views         Array    [{ keyName, name }] rendered as the tab strip (ignored when the `views` slot is used)
 *   activeView    String   keyName of the active tab
 *   favourite     Boolean  star state
 *   agentSummary  Object   { agents, running, elapsedMs, spendUsd } from GET /api/v2/agents/runs — chip hidden when nothing runs
 *   showFilter / showAiAssist / showAddTask / canAddView / showBack   Boolean
 *
 * Emits
 *   select-view(keyName) · add-view · filter · ai-assist · add-task · toggle-favourite · back
 *
 * Slots
 *   title    replaces the swatch + name + star + code (Projects.vue passes its existing title block)
 *   views    replaces the default tab strip (Projects.vue passes its existing ViewsList row)
 *   actions  extra buttons, placed before Filter
 *
 * `+ Task` only emits; the host decides what it opens. Projects.vue bumps a
 * counter it provides as `addTaskRequest`, which the board watches to open its
 * first column's create row.
 */
import { computed, defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

const { t, te } = useI18n();

const props = defineProps({
    project: { type: Object, default: () => ({}) },
    projects: { type: Array, default: () => [] },
    sprint: { type: Object, default: null },
    views: { type: Array, default: () => [] },
    activeView: { type: String, default: '' },
    favourite: { type: Boolean, default: false },
    agentSummary: { type: Object, default: null },
    showFilter: { type: Boolean, default: true },
    showAiAssist: { type: Boolean, default: false },
    showAddTask: { type: Boolean, default: true },
    canAddView: { type: Boolean, default: false },
    showBack: { type: Boolean, default: false }
});

defineEmits(['select-view', 'add-view', 'filter', 'ai-assist', 'add-task', 'toggle-favourite', 'back', 'select-project']);

const PALETTE = ['#2F3990', '#2f9e7e', '#d98324', '#6b5ce7', '#0EA5E9', '#EC4899'];

const swatch = computed(() => {
    const icon = props.project?.projectIcon;
    if (icon?.type === 'color' && icon?.data) return icon.data;
    const hash = Array.from(String(props.project?.ProjectName || '')).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return PALETTE[hash % PALETTE.length];
});

const viewLabel = (view) => (view?.name && te(`ViewList.${view.name}`) ? t(`ViewList.${view.name}`) : (view?.name || ''));

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
    return `${head} · ${t('ProjectsV2.days_left_short', { n: daysLeft })}`;
});

const agentChip = computed(() => {
    const s = props.agentSummary;
    if (!s || !Number(s.agents)) return null;
    const minutes = Math.max(0, Math.round(Number(s.elapsedMs || 0) / 60000));
    const spend = Number(s.spendUsd || 0);
    return { agents: Number(s.agents), meta: `${minutes}m · $${spend.toFixed(2)}` };
});
</script>

<style>
@import "./project-header.css";
</style>
