<template>
    <div v-if="decision" class="trs" aria-live="polite" data-test="role-suggestion">
        <div class="trs__chip" :class="{ 'trs__chip--done': !waiting }">
            <span class="trs__text">
                <strong>{{ headline }}</strong>
                <span v-if="reason" class="trs__reason"><span aria-hidden="true">&nbsp;·&nbsp;</span>{{ reason }}</span>
                <span v-if="modelReason" class="trs__model-reason" data-test="model-reason"><span class="trs__label">{{ $t('Dispatcher.model_reason') }}</span> {{ modelReason }}</span>
            </span>
            <span v-if="canDecide && waiting" class="trs__actions">
                <template v-if="decision.state === 'suggested'">
                    <button type="button" class="trs__btn trs__btn--primary" data-test="role-accept" :disabled="busy" @click="act('accept')">{{ $t('Dispatcher.accept') }}</button>
                    <button type="button" class="trs__btn" data-test="role-dismiss" :disabled="busy" @click="act('dismiss')">{{ $t('Dispatcher.dismiss') }}</button>
                </template>
                <template v-if="otherRoles.length">
                    <label class="trs__sr" :for="pickId">{{ $t('Dispatcher.pick_role') }}</label>
                    <select :id="pickId" v-model="picked" class="trs__select" data-test="role-pick" :disabled="busy">
                        <option value="">{{ $t('Dispatcher.pick_role') }}</option>
                        <option v-for="role in otherRoles" :key="role.key" :value="role.key">{{ role.name }}</option>
                    </select>
                    <button type="button" class="trs__btn" data-test="role-route" :disabled="busy || !picked" @click="act('route', { role: picked })">{{ $t('Dispatcher.send') }}</button>
                </template>
            </span>
        </div>
        <div v-if="offer && canDecide" class="trs__offer" data-test="role-offer">
            <span>{{ $t('Dispatcher.offer_rule', { role: offer.role.name, times: offer.times }) }}</span>
            <button type="button" class="trs__btn" data-test="role-offer-add" :disabled="busy" @click="addOffer">{{ $t('Dispatcher.offer_add') }}</button>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useGetterFunctions } from "@/composable";
import { actOnRouting, addRoutingRule, fetchTaskRouting, useDispatcherChanges } from "@/utils/dispatcher";
import { refusalText } from "@/utils/assignmentRules";

defineOptions({ name: "TaskRoleSuggestion" });

const props = defineProps({
    task: { type: Object, required: true },
    canDecide: { type: Boolean, default: false }
});

const WAITING = ["suggested", "needs_routing"];

const { t } = useI18n();
const $toast = useToast();
const { getUser } = useGetterFunctions();

const decision = ref(null);
const roles = ref([]);
const offer = ref(null);
const picked = ref("");
const busy = ref(false);
const pickId = `trs-${Math.random().toString(36).slice(2, 8)}`;

const waiting = computed(() => WAITING.includes(decision.value?.state));
const otherRoles = computed(() => roles.value.filter((role) => role.key !== decision.value?.role || decision.value?.state !== "suggested"));
const headline = computed(() => {
    const d = decision.value;
    if (!d) return "";
    if (d.state === "suggested") return t("Dispatcher.suggests", { role: d.roleName });
    if (d.state === "needs_routing") return t("Dispatcher.needs_routing");
    const person = () => getUser(d.resolvedBy)?.Employee_Name || t("Dispatcher.someone");
    if (d.state === "routed") return t("Dispatcher.routed_by", { role: d.roleName, person: person() });
    if (d.state === "accepted" && d.resolvedBy) return t("Dispatcher.accepted_by", { role: d.roleName, person: person() });
    return t("Dispatcher.routed_to", { role: d.roleName });
});
const reason = computed(() => {
    const d = decision.value;
    if (!d || d.state === "routed") return "";
    if (d.source === "rule") return t("Dispatcher.by_rule", { n: Number(d.ruleIndex) + 1 });
    if (d.source === "model") return t("Dispatcher.by_model", { confidence: d.confidence });
    return "";
});

const modelReason = computed(() => {
    const d = decision.value;
    return d && d.source === "model" && d.state !== "routed" ? String(d.reason || "").slice(0, 200) : "";
});

async function load(taskId) {
    if (!taskId) return;
    try {
        const data = await fetchTaskRouting(taskId);
        if (taskId !== props.task?._id) return;
        decision.value = data?.on ? data.decision : null;
        roles.value = data?.roles || [];
    } catch (e) {
        decision.value = null;
    }
}

watch(() => props.task?._id, (taskId) => {
    decision.value = null;
    offer.value = null;
    picked.value = "";
    load(taskId);
}, { immediate: true });

useDispatcherChanges(() => { if (!busy.value) load(props.task?._id); });

async function act(action, body) {
    const d = decision.value;
    if (!d || busy.value) return;
    busy.value = true;
    try {
        const data = await actOnRouting(props.task._id, d._id, action, body);
        decision.value = action === "dismiss" ? null : data?.decision || null;
        offer.value = data?.offer || null;
        picked.value = "";
    } catch (e) {
        $toast.error(refusalText(e, t("Dispatcher.failed")), { position: "top-right" });
    } finally {
        busy.value = false;
    }
}

async function addOffer() {
    if (!offer.value || busy.value) return;
    busy.value = true;
    try {
        await addRoutingRule(props.task.ProjectID, { role: offer.value.role.key, when: offer.value.when });
        offer.value = null;
        $toast.success(t("Dispatcher.offer_added"), { position: "top-right" });
    } catch (e) {
        $toast.error(refusalText(e, t("Dispatcher.failed")), { position: "top-right" });
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.trs__chip, .trs__offer {
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
.trs__chip--done, .trs__offer { background: var(--surface-2); border: 1px solid var(--border); }
.trs__text { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; }
.trs__reason { color: var(--ink-2); }
.trs__model-reason { display: block; color: var(--ink-2); white-space: normal; }
.trs__label { font-weight: 600; }
.trs__actions { display: inline-flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.trs__select {
    height: 26px;
    max-width: 100%;
    border-radius: var(--r-input, 8px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink);
    font: 400 var(--fs-sm, 12px)/1 var(--font-ui);
}
.trs__btn {
    height: 26px;
    padding: 0 10px;
    border-radius: var(--r-input, 8px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink);
    font: 600 var(--fs-sm, 12px)/1 var(--font-ui);
    cursor: pointer;
}
.trs__btn--primary { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.trs__btn:disabled { opacity: .55; cursor: not-allowed; }
.trs__btn:focus-visible, .trs__select:focus-visible { outline: none; box-shadow: var(--focus); }
.trs__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
