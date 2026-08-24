<template>
    <Teleport to="body">
        <div class="csm__wrap" @click.self="$emit('close')">
            <div class="csm" role="dialog" aria-modal="true" :aria-label="$t('Scrum.complete_sprint')">
                <div class="csm__head">
                    <h3 class="csm__title">{{ $t('Scrum.complete_sprint') }}</h3>
                    <span class="csm__sub">{{ sprint?.name }}</span>
                </div>

                <div v-if="loading" class="csm__msg">{{ $t('Scrum.loading') }}</div>
                <div v-else-if="loadError" class="csm__problem">{{ loadError }}</div>

                <template v-else-if="preview">
                    <div class="csm__totals">
                        <div class="csm__total">
                            <span class="csm__total-n">{{ preview.done.tasks }}</span>
                            <span class="csm__total-l">{{ $t('Scrum.completed') }}</span>
                        </div>
                        <div class="csm__total csm__total--open">
                            <span class="csm__total-n">{{ preview.notDone.tasks }}</span>
                            <span class="csm__total-l">{{ $t('Scrum.not_completed') }}</span>
                        </div>
                        <div v-if="preview.addedAfterStart" class="csm__total csm__total--added">
                            <span class="csm__total-n">{{ preview.addedAfterStart }}</span>
                            <span class="csm__total-l">{{ $t('Scrum.added_after_start') }}</span>
                        </div>
                    </div>

                    <div v-if="preview.notDone.list.length" class="csm__unfinished">
                        <span class="csm__label">{{ $t('Scrum.moving_these') }}</span>
                        <ul class="csm__list">
                            <li v-for="task in preview.notDone.list" :key="task._id">
                                <span class="csm__key">{{ task.TaskKey }}</span>{{ task.TaskName }}
                            </li>
                        </ul>
                        <em class="csm__hint">{{ $t('Scrum.subtasks_travel') }}</em>
                    </div>

                    <div v-if="preview.notDone.list.length" class="csm__field">
                        <span class="csm__label">{{ $t('Scrum.where_should_it_go') }}</span>
                        <select v-model="destination" class="csm__input">
                            <option value="next">
                                {{ nextSprint
                                    ? $t('Scrum.into_named_sprint', { name: nextSprint.name })
                                    : $t('Scrum.into_new_sprint', { name: preview.suggestedNext.name }) }}
                            </option>
                            <option value="backlog">{{ $t('Scrum.into_backlog') }}</option>
                            <option v-for="option in openSprints" :key="option.id" :value="option.id">
                                {{ option.name }}
                            </option>
                        </select>
                        <em v-if="destination === 'next' && !nextSprint" class="csm__hint">
                            {{ $t('Scrum.new_sprint_dates', { from: dateLabel(preview.suggestedNext.startDate), to: dateLabel(preview.suggestedNext.endDate) }) }}
                        </em>
                    </div>

                    <p v-else class="csm__msg">{{ $t('Scrum.everything_done') }}</p>

                    <p v-if="problem" class="csm__problem">{{ problem }}</p>
                </template>

                <div class="csm__actions">
                    <button type="button" class="csm__btn" @click="$emit('close')">{{ $t('Projects.cancel') }}</button>
                    <button
                        type="button"
                        class="csm__btn csm__btn--primary"
                        :disabled="busy || loading || !preview"
                        @click="confirm"
                    >{{ busy ? '…' : $t('Scrum.complete_sprint') }}</button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script>
export default { name: 'CompleteSprintModal' };
</script>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';

const props = defineProps({
    sprint: { type: Object, required: true },
    // Other sprints in the project, so the work can go somewhere specific.
    siblings: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'completed']);

const { t } = useI18n();
const $toast = useToast();

const loading = ref(true);
const loadError = ref('');
const busy = ref(false);
const problem = ref('');
const preview = ref(null);
const destination = ref('next');

const sprintId = computed(() => props.sprint?.id || props.sprint?._id);

// Anything still open, excluding this sprint and the backlog — the backlog has
// its own entry so it does not depend on being in the passed-in list.
const openSprints = computed(() => (props.siblings || [])
    .filter((s) => String(s.id || s._id) !== String(sprintId.value))
    .filter((s) => !s.isFolder && !s.isBacklog && s.mainChat !== true)
    .filter((s) => String(s.state || '') !== 'closed')
    .filter((s) => !s.deletedStatusKey)
    .map((s) => ({ id: String(s.id || s._id), name: s.name || 'Sprint' })));

// A sprint already planned to follow this one, if the team made one.
const nextSprint = computed(() => (props.siblings || [])
    .filter((s) => String(s.id || s._id) !== String(sprintId.value))
    .filter((s) => s.isScrum && String(s.state || '') === 'planned' && !s.deletedStatusKey)
    .sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0))[0] || null);

const dateLabel = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const load = async () => {
    loading.value = true;
    loadError.value = '';
    try {
        const res = await apiRequest('get', `/api/v2/sprints/complete-preview?sprintId=${encodeURIComponent(sprintId.value)}`);
        if (!res?.data?.status) {
            loadError.value = res?.data?.statusText || t('Toast.something_went_wrong');
            return;
        }
        preview.value = res.data.data;
    } catch (error) {
        loadError.value = error?.message || t('Toast.something_went_wrong');
    } finally {
        loading.value = false;
    }
};

const confirm = async () => {
    if (busy.value) return;
    busy.value = true;
    problem.value = '';
    try {
        const res = await apiRequest('post', '/api/v2/sprints/complete', {
            sprintId: sprintId.value,
            incompleteDestination: destination.value,
        });
        if (!res?.data?.status) {
            // Shown in the dialog, not as a toast: the reason is usually about a
            // choice made right here, and the choice is still on screen.
            problem.value = res?.data?.statusText || t('Toast.something_went_wrong');
            busy.value = false;
            return;
        }
        $toast.success(t('Scrum.sprint_completed'), { position: 'top-right' });
        emit('completed', res.data.data);
        emit('close');
    } catch (error) {
        problem.value = error?.message || t('Toast.something_went_wrong');
        busy.value = false;
    }
};

const onKey = (e) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => { document.addEventListener('keydown', onKey); load(); });
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<style scoped>
.csm__wrap {
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
.csm {
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    overflow-y: auto;
    background: #fff;
    border-radius: 12px;
    padding: 22px;
    box-shadow: 0 18px 48px rgba(17, 20, 33, .22);
}
.csm__head { margin-bottom: 16px; }
.csm__title { margin: 0; font-size: 17px; font-weight: 600; color: #1f2333; }
.csm__sub { display: block; margin-top: 3px; font-size: 13px; color: #6b7280; }

.csm__totals { display: flex; gap: 10px; margin-bottom: 16px; }
.csm__total {
    flex: 1;
    padding: 12px;
    border-radius: 10px;
    background: #eef7f0;
    text-align: center;
}
.csm__total--open { background: #fdf4e7; }
.csm__total--added { background: #f1f1f7; }
.csm__total-n { display: block; font-size: 20px; font-weight: 600; color: #1f2333; font-variant-numeric: tabular-nums; }
.csm__total-l { display: block; margin-top: 2px; font-size: 11.5px; color: #6b7280; }

.csm__unfinished { margin-bottom: 16px; }
.csm__list { margin: 6px 0 0; padding: 0 0 0 2px; list-style: none; max-height: 150px; overflow-y: auto; }
.csm__list li { font-size: 13px; color: #1f2333; padding: 4px 0; border-bottom: 1px solid #f1f1f5; }
.csm__key { display: inline-block; min-width: 74px; font-size: 11.5px; color: #8b90a0; font-variant-numeric: tabular-nums; }

.csm__field { display: block; }
.csm__label { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 500; color: #4b5162; }
.csm__input {
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
.csm__input:focus { border-color: #2f3a8f; }
.csm__hint { display: block; margin-top: 6px; font-size: 11.5px; font-style: normal; color: #8b90a0; line-height: 1.45; }
.csm__msg { margin: 0; font-size: 13px; color: #6b7280; }
.csm__problem { margin: 12px 0 0; font-size: 12.5px; color: #b02a2a; }

.csm__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.csm__btn {
    border: 1px solid #dfe1ec;
    background: #fff;
    color: #1f2333;
    font-family: inherit;
    font-size: 13px;
    padding: 9px 18px;
    border-radius: 8px;
    cursor: pointer;
}
.csm__btn:hover { background: #f5f6fa; }
.csm__btn--primary { background: #2f3a8f; border-color: #2f3a8f; color: #fff; }
.csm__btn--primary:hover:not(:disabled) { background: #26307a; }
.csm__btn:disabled { opacity: .55; cursor: default; }
</style>
