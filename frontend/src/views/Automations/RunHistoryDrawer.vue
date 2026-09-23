<template>
    <div class="au-runs" data-test="runs-drawer">
        <div class="au-runs__scrim" @click="$emit('close')"></div>
        <aside class="au-runs__panel" role="dialog" aria-modal="true" :aria-label="$t('Automations.runs_title')" @keydown.esc="$emit('close')">
            <header class="au-runs__head">
                <div class="au-runs__heading">
                    <div class="ah-toolbar__title">{{ $t('Automations.runs_title') }}</div>
                    <p class="ah-small au-runs__rule">{{ rule.sentence || rule.summary || rule.name }}</p>
                </div>
                <button ref="closeButton" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="runs-close" :aria-label="$t('Automations.runs_close')" @click="$emit('close')">
                    <ShellIcon name="x" :size="16" />
                </button>
            </header>

            <div class="au-runs__body ah-scroll">
                <p v-if="loading" class="ah-empty">{{ $t('Automations.runs_loading') }}</p>
                <p v-else-if="loadError" class="ah-field__error">{{ $t('Automations.runs_error') }}</p>
                <p v-else-if="!runs.length" class="ah-empty" data-test="runs-empty">{{ $t('Automations.runs_empty') }}</p>
                <template v-else>
                    <ol class="au-runs__list">
                        <li v-for="run in runs" :key="run._id" class="au-runs__row" data-test="run-row">
                            <div class="au-runs__meta">
                                <span data-test="run-when">{{ when(run) }}</span>
                                <span class="ah-mono" data-test="run-duration">{{ duration(run) ? $t(duration(run).key, { n: duration(run).n }) : '—' }}</span>
                            </div>
                            <div class="ah-small au-runs__trigger" data-test="run-trigger">{{ triggerLabel(run.eventType) }}</div>
                            <div class="au-runs__task" data-test="run-task">
                                <button v-if="taskOf(run).id" type="button" class="au-runs__key ah-mono" @click="openRunTask(run)">{{ taskOf(run).key || '—' }}</button>
                                <span v-else class="ah-mono">—</span>
                                <span v-if="taskOf(run).name" class="au-runs__name">{{ taskOf(run).name }}</span>
                            </div>
                            <div class="au-runs__outcome" data-test="run-outcome">
                                <span class="ah-chip" :class="outcomeOf(run).chip">{{ $t(outcomeOf(run).key) }}</span>
                                <span v-if="stoppedAt(run)" class="ah-small">{{ $t('Automations.stopped_at_condition', { id: stoppedAt(run) }) }}</span>
                                <ul v-if="actionSteps(run).length" class="au-runs__steps">
                                    <li v-for="step in actionSteps(run)" :key="step.id">
                                        {{ actionLabel(step.action) }}<template v-if="step.output && step.output.changed === false"> · {{ $t('Automations.step_no_change') }}</template>
                                        <span v-if="step.error" class="au-runs__error"> · {{ step.error }}</span>
                                    </li>
                                </ul>
                                <p v-if="run.error && ['failed', 'retrying'].includes(run.status)" class="au-runs__error">{{ run.error }}</p>
                            </div>
                        </li>
                    </ol>
                    <p v-if="runs.length >= RUNS_LIMIT" class="ah-small au-runs__limit" data-test="runs-limit">{{ $t('Automations.runs_limit', { n: RUNS_LIMIT }) }}</p>
                </template>
            </div>
        </aside>
    </div>
</template>

<script setup>
import { ref, inject, onMounted, nextTick } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

defineOptions({ name: 'RunHistoryDrawer' });

const props = defineProps({
    rule: { type: Object, required: true },
    triggers: { type: Array, default: () => [] },
    actions: { type: Array, default: () => [] },
});
defineEmits(['close']);

// The endpoint answers the newest 50 and does not page.
const RUNS_LIMIT = 50;

const companyId = inject('$companyId', ref(''));
const runs = ref([]);
const loading = ref(true);
const loadError = ref(false);
const closeButton = ref(null);

const OUTCOMES = {
    success: { key: 'Automations.outcome_applied', chip: 'ah-chip--ok' },
    stopped: { key: 'Automations.outcome_skipped', chip: 'ah-chip--warn' },
    failed: { key: 'Automations.outcome_failed', chip: 'ah-chip--danger' },
    retrying: { key: 'Automations.outcome_retrying', chip: 'ah-chip--warn' },
    running: { key: 'Automations.outcome_running', chip: 'ah-chip--brand' },
    queued: { key: 'Automations.outcome_queued', chip: 'ah-chip--brand' },
};
const outcomeOf = (run) => OUTCOMES[run.status] || OUTCOMES.queued;

const when = (run) => (run.startedAt ? new Date(run.startedAt).toLocaleString() : '—');

const duration = (run) => {
    if (!run.startedAt || !run.finishedAt) return null;
    const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    if (ms < 1000) return { key: 'Automations.duration_ms', n: ms };
    if (ms < 60000) return { key: 'Automations.duration_s', n: Number((ms / 1000).toFixed(1)) };
    return { key: 'Automations.duration_min', n: Number((ms / 60000).toFixed(1)) };
};

const triggerLabel = (eventType) => props.triggers.find((trigger) => trigger.key === eventType)?.label || eventType || '—';
const actionLabel = (key) => props.actions.find((action) => action.key === key)?.label || key;

const taskOf = (run) => {
    const entity = run.entity || {};
    const envelope = run.envelope || {};
    if (entity.kind && entity.kind !== 'task') return { id: '', key: '', name: '' };
    return { id: entity.id || '', key: entity.key || '', name: envelope.data?.TaskName || '' };
};

const actionSteps = (run) => (run.steps || []).filter((step) => step && step.type === 'action');

const stoppedAt = (run) => {
    if (run.status !== 'stopped') return '';
    const stop = (run.steps || []).find((step) => step && step.type === 'condition' && step.output && step.output.passed === false);
    return stop ? stop.id : '';
};

const openRunTask = (run) => {
    const scope = run.envelope?.scope || {};
    openTask({ companyId: companyId.value, projectId: scope.projectId, sprintId: scope.sprintId, folderId: scope.folderId, taskId: taskOf(run).id });
};

onMounted(async () => {
    try {
        const body = (await apiRequest('get', `${env.AUTOMATIONS_V2}/${props.rule._id}/runs`))?.data;
        if (body && body.status === false) loadError.value = true;
        else runs.value = Array.isArray(body?.data) ? body.data : [];
    } catch (e) {
        loadError.value = true;
    } finally {
        loading.value = false;
    }
    await nextTick();
    closeButton.value?.focus?.();
});
</script>
