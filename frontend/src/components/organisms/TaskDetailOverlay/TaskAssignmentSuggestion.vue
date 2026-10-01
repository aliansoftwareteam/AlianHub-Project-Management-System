<template>
    <div class="tas" aria-live="polite">
        <div v-if="visible" class="tas__chip" :class="`tas__chip--${decision.state}`" data-test="assignment-suggestion">
            <span class="tas__text">
                <strong>{{ headline }}</strong>
                <span v-if="decision.source === 'fallback'" class="tas__tag">{{ $t('AssignmentRules.chip_fallback') }}</span>
                <span v-if="decision.reason" class="tas__reason">{{ decision.reason }}</span>
            </span>
            <span v-if="canAssign" class="tas__actions">
                <template v-if="decision.state === 'suggested'">
                    <button type="button" class="tas__btn tas__btn--primary" data-test="suggestion-assign" :disabled="busy" @click="act('accept')">{{ $t('AssignmentRules.chip_assign') }}</button>
                    <button type="button" class="tas__btn" data-test="suggestion-dismiss" :disabled="busy" @click="act('dismiss')">{{ $t('AssignmentRules.chip_dismiss') }}</button>
                </template>
                <button v-else type="button" class="tas__btn" data-test="suggestion-undo" :disabled="busy" @click="act('undo')">{{ $t('AssignmentRules.chip_undo') }}</button>
            </span>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useGetterFunctions } from "@/composable";
import { actOnSuggestion, fetchTaskSuggestion, refusalText } from "@/utils/assignmentRules";

defineOptions({ name: "TaskAssignmentSuggestion" });

const props = defineProps({
    task: { type: Object, required: true },
    canAssign: { type: Boolean, default: false }
});

/* A new task is decided a few seconds after it is saved, so the chip looks again for a short while. */
const POLL_MS = 4000;
const POLL_TRIES = 8;

const { t } = useI18n();
const $toast = useToast();
const { getUser } = useGetterFunctions();

const decision = ref(null);
const busy = ref(false);
let timer = null;
let tries = 0;

const assignees = computed(() => (props.task?.AssigneeUserId || []).map(String));
const visible = computed(() => {
    const d = decision.value;
    if (!d) return false;
    if (d.state === "suggested") return assignees.value.length === 0;
    if (d.state === "applied") return assignees.value.includes(String(d.userId));
    return false;
});
const personName = computed(() => (decision.value ? getUser(decision.value.userId)?.Employee_Name || "" : ""));
const headline = computed(() => (decision.value?.state === "applied"
    ? t("AssignmentRules.chip_assigned_by_rule", { name: personName.value })
    : t("AssignmentRules.chip_suggests", { name: personName.value })));

const stopPolling = () => {
    if (timer) clearTimeout(timer);
    timer = null;
};

async function load(taskId) {
    stopPolling();
    if (!taskId) return;
    try {
        const data = await fetchTaskSuggestion(taskId);
        if (taskId !== props.task?._id) return;
        decision.value = data?.decision || null;
        if (data?.pending && tries < POLL_TRIES) {
            tries += 1;
            timer = setTimeout(() => load(taskId), POLL_MS);
        }
    } catch (e) {
        decision.value = null;
    }
}

watch(() => props.task?._id, (taskId) => {
    tries = 0;
    decision.value = null;
    load(taskId);
}, { immediate: true });

watch(() => assignees.value.join(","), () => {
    if (decision.value?.state === "applied" && !visible.value) decision.value = null;
});

onBeforeUnmount(stopPolling);

async function act(action) {
    const d = decision.value;
    if (!d || busy.value) return;
    busy.value = true;
    try {
        await actOnSuggestion(props.task._id, d._id, action);
        decision.value = null;
    } catch (e) {
        $toast.error(refusalText(e, t("AssignmentRules.chip_failed")), { position: "top-right" });
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.tas__chip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 4px 0 8px;
    padding: 6px 10px;
    border-radius: var(--r-input, 8px);
    background: var(--brand-tint);
    color: var(--ink);
    font: 400 var(--fs-md, 12.5px)/1.4 var(--font-ui);
    max-width: 100%;
    box-sizing: border-box;
}
.tas__chip--applied { background: var(--surface-2); border: 1px solid var(--border); }
.tas__text { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; }
.tas__tag { margin-left: 6px; font-size: var(--fs-sm, 11.5px); color: var(--ink-2); }
.tas__reason { color: var(--ink-2); margin-left: 4px; }
.tas__reason::before { content: "\2014\00a0"; }
.tas__actions { display: inline-flex; gap: 6px; flex: none; }
.tas__btn {
    height: 26px;
    padding: 0 10px;
    border-radius: var(--r-input, 8px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink);
    font: 600 var(--fs-sm, 12px)/1 var(--font-ui);
    cursor: pointer;
}
.tas__btn--primary { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.tas__btn:disabled { opacity: .55; cursor: not-allowed; }
.tas__btn:focus-visible { outline: none; box-shadow: var(--focus); }
</style>
