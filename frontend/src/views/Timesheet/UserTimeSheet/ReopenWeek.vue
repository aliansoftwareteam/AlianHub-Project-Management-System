<template>
    <button v-if="shown" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="reopen-week" @click="asking = true">{{ t('Time.reopen_week') }}</button>
    <teleport to="body">
        <div v-if="asking" class="rw__overlay" @click.self="cancel" @keydown.esc="cancel">
            <div class="rw__card" role="alertdialog" aria-modal="true" :aria-label="t('Time.reopen_title')">
                <h3 class="ah-h3 rw__title">{{ t('Time.reopen_title') }}</h3>
                <p class="rw__text">{{ t('Time.reopen_text', { name: personName, range }) }}</p>
                <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>
                <div class="rw__actions">
                    <button ref="cancelButton" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="cancel">{{ t('Time.cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" data-action="confirm" @click="reopen">{{ busy ? t('Time.reopening') : t('Time.reopen_week') }}</button>
                </div>
            </div>
        </div>
    </teleport>
</template>

<script setup>
/**
 * Reopens an approved timesheet week, for the people who may approve it. The server puts the week
 * back to submitted and writes who reopened it into its history.
 *
 * Props
 *   approval     Object   the week's approval document, or null
 *   personName   String   whose week it is
 *   range        String   the week, as the page words it
 *
 * Emits
 *   reopened(approval)   the week as the server now holds it
 */
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { canApprove } from "@/views/Approvals/approvalAccess";

defineOptions({ name: "ReopenWeek" });

const props = defineProps({
    approval: { type: Object, default: null },
    personName: { type: String, default: "" },
    range: { type: String, default: "" }
});
const emit = defineEmits(["reopened"]);

const { t } = useI18n();
const { getters } = useStore();

const asking = ref(false);
const busy = ref(false);
const error = ref("");
const cancelButton = ref(null);

const shown = computed(() => props.approval?.status === "approved" && Boolean(props.approval._id) && canApprove(getters["settings/companyUserDetail"]));

watch(asking, (now) => { if (now) nextTick(() => cancelButton.value?.focus()); });

function cancel() {
    if (busy.value) return;
    asking.value = false;
    error.value = "";
}

async function reopen() {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
        const answer = ((await apiRequest("post", `${env.TIMESHEET_APPROVAL}/${props.approval._id}/review`, { action: "reopen" })) || {}).data || {};
        if (!answer.status) throw new Error(answer.statusText || "");
        asking.value = false;
        emit("reopened", answer.data);
    } catch (failure) {
        error.value = failure.message || t("Time.action_failed");
    } finally {
        busy.value = false;
    }
}
</script>

<style>
.rw__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--sp-7); }
.rw__card { background: var(--surface); color: var(--ink); border-radius: var(--r-card); width: min(420px, 100%); padding: 18px var(--sp-8) 26px; box-shadow: var(--shadow-pop); font-family: var(--font-ui); }
.rw__title { margin: 0 0 var(--sp-5); }
.rw__text { margin: 0 0 var(--sp-8); font-size: var(--fs-md, 13px); line-height: var(--lh-body, 1.5); color: var(--ink-2); overflow-wrap: anywhere; }
.rw__actions { display: flex; justify-content: flex-end; gap: var(--sp-4); }
</style>
