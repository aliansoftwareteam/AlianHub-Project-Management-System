<template>
    <Teleport to="body">
        <div class="css__scrim" @click.self="$emit('close')">
            <div class="css" role="dialog" aria-modal="true" :aria-label="title">
                <h2 class="ah-h3 css__title">{{ title }}</h2>

                <p v-if="loading" class="ah-small">{{ $t('Members.loading') }}</p>
                <p v-else-if="loadError" class="ah-field__error">{{ loadError }}</p>

                <template v-else-if="preview">
                    <p class="css__lead">
                        {{ $t('Members.close_lead', { done: donePoints, total: committedPoints }) }}
                        <template v-if="unfinished.length">
                            <strong>{{ $t('Members.close_unfinished', { count: unfinished.length }) }}</strong>
                            {{ $t('Members.close_decide') }}
                        </template>
                        <template v-else>{{ $t('Members.close_all_done') }}</template>
                    </p>

                    <div v-if="unfinished.length" class="css__options">
                        <label class="css__option" :class="{ 'is-on': choice === 'next' }">
                            <input type="radio" value="next" v-model="choice" />
                            <span class="css__option-text">
                                <span class="css__option-title">{{ nextSprint ? $t('Members.dest_next', { name: nextSprint.name }) : $t('Members.dest_next_new') }}</span>
                                <span class="css__option-hint">
                                    {{ $t('Members.dest_next_hint') }}
                                    <template v-if="!nextSprint && preview.suggestedNext"> · {{ preview.suggestedNext.name }} {{ dateRange(preview.suggestedNext) }}</template>
                                </span>
                            </span>
                        </label>

                        <label class="css__option" :class="{ 'is-on': choice === 'backlog' }">
                            <input type="radio" value="backlog" v-model="choice" />
                            <span class="css__option-text">
                                <span class="css__option-title">{{ $t('Members.dest_backlog') }}</span>
                            </span>
                        </label>

                        <label v-if="openSprints.length" class="css__option" :class="{ 'is-on': choice === 'pick' }">
                            <input type="radio" value="pick" v-model="choice" />
                            <span class="css__option-text">
                                <span class="css__option-title">
                                    {{ $t('Members.dest_pick') }}
                                    <span class="css__option-hint">· {{ $t('Members.dest_pick_hint', { count: unfinished.length }) }}</span>
                                </span>
                                <select v-if="choice === 'pick'" v-model="pickedSprintId" class="ah-input css__select">
                                    <option v-for="option in openSprints" :key="option.id" :value="option.id">{{ option.name }}</option>
                                </select>
                            </span>
                        </label>
                    </div>

                    <div v-if="unfinished.length" class="css__moving">
                        <span class="ah-label">{{ $t('Members.moving_these') }}</span>
                        <ul class="css__list ah-scroll">
                            <li v-for="item in unfinished" :key="item._id">
                                <span class="ah-mono css__key">{{ item.TaskKey }}</span>{{ item.TaskName }}
                            </li>
                        </ul>
                    </div>

                    <p v-if="stranded.length" class="ah-small css__stranded">{{ $t('Members.stranded_note') }}</p>
                    <p v-if="problem" class="ah-field__error">{{ problem }}</p>
                </template>

                <div class="css__actions">
                    <button type="button" class="ah-btn ah-btn--primary" :disabled="busy || loading || !preview" @click="confirm()">
                        {{ busy ? $t('Members.close_working') : $t('Members.close_confirm') }}
                    </button>
                    <button type="button" class="ah-btn ah-btn--secondary" @click="$emit('close')">{{ $t('Members.cancel') }}</button>
                    <span class="ah-small css__final">{{ $t('Members.close_reversible') }}</span>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";

defineOptions({ name: "CloseSprintStep" });

const props = defineProps({
    sprint: { type: Object, required: true },
    siblings: { type: Array, default: () => [] }
});
const emit = defineEmits(["close", "completed"]);

const { t } = useI18n();
const $toast = useToast();

const loading = ref(true);
const loadError = ref("");
const busy = ref(false);
const problem = ref("");
const preview = ref(null);
const choice = ref("next");
const pickedSprintId = ref("");

const sprintId = computed(() => props.sprint?.id || props.sprint?._id);
const title = computed(() => t("Members.close_title", { name: props.sprint?.name || "" }));
const unfinished = computed(() => preview.value?.notDone?.list || []);
const stranded = computed(() => preview.value?.strandedSubtasks?.list || []);
const donePoints = computed(() => preview.value?.done?.points || 0);
const committedPoints = computed(() => {
    const committed = Number(preview.value?.commitment?.points);
    if (Number.isFinite(committed) && committed > 0) return committed;
    return (preview.value?.done?.points || 0) + (preview.value?.notDone?.points || 0);
});

const openSprints = computed(() => (props.siblings || [])
    .filter((s) => String(s.id || s._id) !== String(sprintId.value))
    .filter((s) => !s.isFolder && !s.isBacklog && s.mainChat !== true)
    .filter((s) => String(s.state || "") !== "closed")
    .filter((s) => !s.deletedStatusKey)
    .map((s) => ({ id: String(s.id || s._id), name: s.name || "Sprint" })));

const nextSprint = computed(() => (props.siblings || [])
    .filter((s) => String(s.id || s._id) !== String(sprintId.value))
    .filter((s) => s.isScrum && String(s.state || "") === "planned" && !s.deletedStatusKey)
    .sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0))[0] || null);

function dayLabel(value) {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function dateRange(suggested) {
    const from = dayLabel(suggested.startDate);
    const to = dayLabel(suggested.endDate);
    return from && to ? `${from}–${to}` : "";
}

async function load() {
    loading.value = true;
    loadError.value = "";
    try {
        const res = await apiRequest("get", `/api/v2/sprints/complete-preview?sprintId=${encodeURIComponent(sprintId.value)}`);
        if (!res?.data?.status) {
            loadError.value = res?.data?.statusText || t("Toast.something_went_wrong");
            return;
        }
        preview.value = res.data.data;
        pickedSprintId.value = openSprints.value[0]?.id || "";
    } catch (error) {
        loadError.value = error?.message || t("Toast.something_went_wrong");
    } finally {
        loading.value = false;
    }
}

async function confirm() {
    if (busy.value) return;
    busy.value = true;
    problem.value = "";
    const destination = choice.value === "pick" ? pickedSprintId.value : choice.value;
    try {
        const res = await apiRequest("post", "/api/v2/sprints/complete", {
            sprintId: sprintId.value,
            incompleteDestination: destination
        });
        if (!res?.data?.status) {
            problem.value = res?.data?.statusText || t("Toast.something_went_wrong");
            busy.value = false;
            return;
        }
        $toast.success(t("Scrum.sprint_completed"), { position: "top-right" });
        emit("completed", res.data.data);
        emit("close");
    } catch (error) {
        problem.value = error?.message || t("Toast.something_went_wrong");
        busy.value = false;
    }
}

const onKey = (e) => { if (e.key === "Escape") emit("close"); };
onMounted(() => { document.addEventListener("keydown", onKey); load(); });
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<style scoped>
.css__scrim {
    position: fixed;
    inset: 0;
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(17, 20, 33, .45);
}
.css {
    width: 100%;
    max-width: 480px;
    max-height: 88vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 18px;
    border: 1.5px solid var(--brand);
    border-radius: var(--r-card);
    background: var(--surface);
    color: var(--ink);
    font: var(--text-body);
    box-shadow: var(--shadow-modal);
}
.css__title { font-size: 13px; }
.css__lead { margin: 0; color: var(--ink-2); line-height: 1.5; }
.css__lead strong { color: var(--ink); font-weight: 600; }

.css__options { display: flex; flex-direction: column; gap: 6px; }
.css__option {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: 9px;
    cursor: pointer;
    color: var(--ink-label);
    transition: border-color var(--t-state) var(--ease), background var(--t-state) var(--ease);
}
.css__option.is-on { border: 1.5px solid var(--brand); background: var(--brand-tint); color: var(--ink); }
.css__option input { margin-top: 2px; accent-color: var(--brand); }
.css__option-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.css__option-title { font-weight: 600; }
.css__option-hint { font-size: 11.5px; color: var(--ink-2); font-weight: 400; }
.css__select { height: 32px; margin-top: 4px; }

.css__moving { display: flex; flex-direction: column; gap: 5px; }
.css__list { margin: 0; padding: 0; list-style: none; max-height: 132px; overflow-y: auto; }
.css__list li { padding: 4px 0; border-bottom: 1px solid var(--hairline); font-size: 12.5px; }
.css__key { display: inline-block; min-width: 74px; color: var(--ink-3); }
.css__stranded { margin: 0; }

.css__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.css__final { margin-left: auto; }
</style>
