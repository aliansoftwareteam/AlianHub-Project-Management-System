<template>
    <div class="ai-detail ah-scroll" data-test="report-detail">
        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm ai-back" @click="$emit('back')">
            <ShellIcon name="chevronLeft" :size="14" />{{ $t('Ai.back_to_queue') }}
        </button>
        <div class="ai-detail__crumb">
            <span>{{ report.agentName }}</span>
            <span>· {{ when }}</span>
        </div>
        <h2 class="ai-detail__what">{{ $t(`Ai.report_${body.key || 'daily_briefing'}`) }}</h2>

        <p v-if="body.summary" class="ai-report__summary" data-test="report-summary">{{ body.summary }}</p>
        <p v-else class="ah-small ai-report__summary">{{ $t('Ai.report_no_summary') }}</p>

        <div v-for="(sec, i) in sections" :key="`${sec.key}-${i}`" class="ai-report__section" data-test="report-section">
            <div class="ah-label">
                {{ sec.key === 'project' ? (sec.label || $t('Ai.report_section_project')) : $t(`Ai.report_section_${sec.key}`, { days: sec.days || 0 }) }}
                <span v-if="sec.key !== 'project'" class="ah-mono">{{ sec.total }}</span>
            </div>
            <p v-if="sec.counts" class="ah-small ai-report__counts">{{ $t('Ai.report_project_counts', sec.counts) }}</p>
            <p v-if="!sec.items.length && sec.key !== 'project'" class="ah-small">{{ $t('Ai.report_section_empty') }}</p>
            <ul v-else class="ai-report__items">
                <li v-for="item in sec.items" :key="`${sec.key}-${item.taskId}-${item.commentId || ''}`" class="ai-report__item">
                    <button type="button" class="ai-report__task" @click="open(item)">
                        <span v-if="item.taskKey" class="ah-mono">{{ item.taskKey }}</span>
                        <span class="ai-report__name">{{ item.taskName }}</span>
                    </button>
                    <span v-if="item.projectName" class="ah-small">{{ item.projectName }}</span>
                    <span v-if="item.daysLate" class="ah-chip ah-chip--warn ah-chip--sm">{{ t('Ai.report_days_late', { n: item.daysLate }, item.daysLate) }}</span>
                    <span v-for="reason in item.reasons || []" :key="reason" class="ah-chip ah-chip--sm">{{ $t(`Ai.report_reason_${reason}`) }}</span>
                    <span v-if="item.excerpt" class="ah-small ai-report__excerpt">{{ item.excerpt }}</span>
                </li>
            </ul>
            <p v-if="sec.key !== 'project' && sec.total > sec.items.length" class="ah-small">{{ t('Ai.report_more', { n: sec.total - sec.items.length }, sec.total - sec.items.length) }}</p>
        </div>

        <p class="ai-cost">{{ deliveredLine }}</p>
    </div>
</template>

<script setup>
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { weekdayClockText } from "@/utils/clockText";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { openTask } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";

defineOptions({ name: "AgentReportDetail" });

const props = defineProps({ report: { type: Object, required: true } });
defineEmits(["back"]);

const { t } = useI18n();
const injectedCompanyId = inject("$companyId", null);
const companyId = computed(() => injectedCompanyId?.value ?? injectedCompanyId ?? "");

const body = computed(() => props.report.report || {});
const sections = computed(() => (body.value.sections || []).map((s) => ({ ...s, items: s.items || [] })));
const when = computed(() => weekdayClockText(props.report.slotAt || props.report.startedAt));
const deliveredLine = computed(() => {
    const d = body.value.delivered || {};
    const channels = ["inbox", "email", "comment", "page"].filter((c) => d[c]).map((c) => t(`Ai.report_channel_${c}`));
    return channels.length ? t("Ai.report_delivered_to", { list: channels.join(", ") }) : "";
});

const open = (item) => openTask({ companyId: companyId.value, projectId: item.projectId, sprintId: item.sprintId, folderId: item.folderId, taskId: item.taskId });
</script>

<style>
.ai-report__summary { margin: 8px 0 14px; font: var(--text-body); color: var(--ink); white-space: pre-wrap; }
.ai-report__section { margin-top: 14px; }
.ai-report__section .ah-label { display: flex; gap: 8px; align-items: baseline; }
.ai-report__counts { margin: 4px 0; color: var(--ink-2); }
.ai-report__items { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ai-report__item { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: baseline; }
.ai-report__task { border: 0; background: transparent; padding: 0; cursor: pointer; display: inline-flex; gap: 6px; color: var(--ink); font: var(--text-body); text-align: left; min-width: 0; }
.ai-report__task:hover .ai-report__name { text-decoration: underline; }
.ai-report__name { overflow-wrap: anywhere; }
.ai-report__excerpt { flex-basis: 100%; color: var(--ink-2); overflow-wrap: anywhere; }
</style>
