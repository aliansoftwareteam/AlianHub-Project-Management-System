<template>
    <teleport to="body">
        <div class="glk__overlay" @click.self="$emit('close')" @keydown.esc.stop="$emit('close')">
            <form class="glk" role="dialog" aria-modal="true" :aria-labelledby="`${uid}-title`" data-test="glk" @submit.prevent="save">
                <h3 :id="`${uid}-title`" class="ah-h3 glk__title">{{ $t('Goals.link_title') }}</h3>
                <p class="glk__hint">{{ $t(source.kind === 'sprintIds' ? 'Goals.link_list_hint' : 'Goals.link_task_hint', { name: source.name }) }}</p>

                <p v-if="state === 'loading'" class="glk__hint" role="status" data-test="glk-loading">{{ $t('Goals.link_loading') }}</p>
                <p v-else-if="state === 'failed'" class="glk__hint" role="alert" data-test="glk-failed">
                    {{ $t('Goals.link_failed') }}
                    <button type="button" class="glk__retry" @click="load">{{ $t('Goals.count_retry') }}</button>
                </p>
                <p v-else-if="!goals.length" class="glk__hint" data-test="glk-none">
                    {{ $t('Goals.link_no_goals') }}
                    <button v-if="canMakeGoal" type="button" class="glk__retry" data-test="glk-new-goal" @click="newGoal">{{ $t('Goals.new_goal') }}</button>
                </p>
                <template v-else>
                    <label class="ah-field">
                        <span class="ah-field__label">{{ $t('Goals.link_goal') }}</span>
                        <select ref="goalSelect" v-model="goalId" class="ah-input" data-test="glk-goal" @change="pickTarget">
                            <option v-for="goal in goals" :key="goal._id" :value="goal._id">{{ goal.name }}</option>
                        </select>
                    </label>
                    <label class="ah-field">
                        <span class="ah-field__label">{{ $t('Goals.link_target') }}</span>
                        <select v-model="targetId" class="ah-input" data-test="glk-target" @change="error = ''">
                            <option v-for="target in targets" :key="target.id" :value="target.id" :disabled="target.holds">
                                {{ target.holds ? $t('Goals.link_target_already', { name: target.name }) : target.name }}
                            </option>
                            <option v-if="roomForTarget" :value="NEW_TARGET">{{ $t('Goals.link_target_new') }}</option>
                        </select>
                    </label>
                    <label v-if="targetId === NEW_TARGET" class="ah-field">
                        <span class="ah-field__label">{{ $t('Goals.target_name') }}</span>
                        <input v-model="name" type="text" class="ah-input" :maxlength="LIMITS.name" data-test="glk-name" @input="error = ''" />
                    </label>
                    <span v-if="error" class="ah-field__error" role="alert" data-test="glk-error">{{ error }}</span>
                </template>

                <div class="glk__actions">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="glk-cancel" @click="$emit('close')">{{ $t('Goals.cancel') }}</button>
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-test="glk-save" :disabled="!targetId || busy">{{ $t(busy ? 'Goals.saving' : 'Goals.link_save') }}</button>
                </div>
            </form>
        </div>
    </teleport>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, ref, unref } from "vue";
import { routerKey } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import { LIMITS, TASKS, addTargetRequest, refusalKey, sourcesOf, sourcesRequest } from "./goalRequest";
import { linkableGoals, linkableGoalsAreStale, loadLinkableGoals, noteLinked } from "./goalLinking";

defineOptions({ name: "GoalLinkPicker" });

const NEW_TARGET = "new";
const TOAST = { position: "top-right" };
const SAID = { 403: "Goals.not_allowed", 404: "Goals.goal_missing_title", 409: "Goals.conflict" };
const FULL = { sprintIds: "Goals.sources_lists_full", taskIds: "Goals.sources_tasks_full" };

const props = defineProps({
    /* { kind: 'taskIds' | 'sprintIds', id, name } */
    source: { type: Object, required: true }
});
const emit = defineEmits(["close", "linked"]);

const { t, te } = useI18n();
const toast = useToast();
/* Injected, not taken with useRouter, which warns where a menu is drawn outside a router. */
const router = inject(routerKey, null);
const companyId = inject("$companyId", "");
const uid = `glk-${Math.random().toString(36).slice(2, 8)}`;

const goalId = ref("");
const targetId = ref("");
const name = ref(String(props.source.name || "").slice(0, LIMITS.name));
const error = ref("");
const busy = ref(false);
const goalSelect = ref(null);

const state = computed(() => (linkableGoals.status === "idle" ? "loading" : linkableGoals.status));
const goals = computed(() => [...linkableGoals.goals].sort((a, b) => String(a.name).localeCompare(String(b.name))));
const goal = computed(() => goals.value.find((entry) => entry._id === goalId.value) || null);
const targets = computed(() => (goal.value?.targets || [])
    .filter((target) => target.kind === TASKS)
    .map((target) => ({ ...target, holds: sourcesOf(target.sources)[props.source.kind].includes(String(props.source.id)) })));
const roomForTarget = computed(() => Boolean(goal.value) && (goal.value.targets || []).length < LIMITS.targets);

function pickTarget() {
    error.value = "";
    const free = targets.value.find((target) => !target.holds);
    targetId.value = free ? free.id : (roomForTarget.value ? NEW_TARGET : "");
}

const canMakeGoal = computed(() => Boolean(router?.hasRoute?.("Goals")));

function newGoal() {
    router.push({ name: "Goals", params: { cid: unref(companyId) }, query: { new: "1" } }).catch(() => {});
    emit("close");
}

async function load() {
    await loadLinkableGoals(unref(companyId), { again: linkableGoalsAreStale() });
    if (!goal.value) goalId.value = goals.value[0]?._id || "";
    pickTarget();
    await nextTick();
    goalSelect.value?.focus();
}

function requestOf() {
    if (targetId.value === NEW_TARGET) {
        if (!name.value.trim()) return { refused: "Goals.error_name" };
        return addTargetRequest(goal.value._id, { kind: TASKS, name: name.value, weight: "1", sources: { [props.source.kind]: [String(props.source.id)] } });
    }
    const target = targets.value.find((entry) => entry.id === targetId.value);
    const held = sourcesOf(target.sources);
    if (held[props.source.kind].length >= LIMITS[props.source.kind]) return { refused: FULL[props.source.kind] };
    return sourcesRequest(goal.value._id, target, { ...held, [props.source.kind]: [...held[props.source.kind], String(props.source.id)] });
}

const refusalOf = (failure) => {
    const status = failure?.response?.status;
    const key = status === 400 ? refusalKey(failure.response.data || {}) : SAID[status] || "Goals.save_failed";
    return t(te(key) ? key : "Goals.error_generic");
};

async function save() {
    if (!goal.value || !targetId.value || busy.value) return;
    const request = requestOf();
    if (request.refused) {
        error.value = t(request.refused);
        return;
    }
    const targetName = targetId.value === NEW_TARGET ? name.value.trim() : targets.value.find((entry) => entry.id === targetId.value).name;
    busy.value = true;
    error.value = "";
    try {
        const res = await apiRequest(request.method, request.path, request.body);
        if (!res?.data?.status) throw new Error(res?.data?.message || "Not saved");
        noteLinked(res.data.data);
        toast.success(t("Goals.link_done", { name: props.source.name, target: targetName }), TOAST);
        emit("linked");
        emit("close");
    } catch (failure) {
        error.value = refusalOf(failure);
    }
    busy.value = false;
}

onMounted(load);
</script>

<style scoped>
.glk__overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--sp-7, 16px); background: var(--scrim); }
.glk { width: min(420px, 100%); max-height: 100%; overflow: auto; display: flex; flex-direction: column; gap: var(--sp-5, 10px); padding: 18px var(--sp-8, 20px) 20px; border-radius: var(--r-card); background: var(--surface); color: var(--ink); box-shadow: var(--shadow-pop); font-family: var(--font-ui); }
.glk__title { margin: 0; }
.glk__hint { margin: 0; font: var(--text-small); color: var(--ink-2); overflow-wrap: anywhere; }
.glk__retry { display: inline-flex; align-items: center; min-height: var(--hit-min); border: 0; background: none; padding: 0; color: var(--brand); font: inherit; font-weight: 600; cursor: pointer; }
.glk__actions { display: flex; justify-content: flex-end; gap: var(--sp-4, 8px); margin-top: var(--sp-3, 6px); }
</style>
