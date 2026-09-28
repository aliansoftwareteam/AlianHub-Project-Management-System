<template>
    <span class="cfc est-cell" @click.stop>
        <input
            v-if="editing"
            ref="input"
            v-model="draft"
            type="text"
            class="cfc__input est-cell__input"
            :aria-label="$t('ViewColumns.estimate_label')"
            :placeholder="$t('ViewColumns.estimate_placeholder')"
            @keydown.enter.prevent="commit"
            @keydown.esc="cancel"
            @blur="commit"
        />
        <button
            v-else-if="editable"
            ref="trigger"
            type="button"
            class="cfc__btn"
            data-cell-edit
            :aria-label="label"
            :title="text || null"
            @click="start"
        >
            <span v-if="text" class="cfc__text">{{ text }}</span>
            <ShellIcon v-else name="clock" :size="12" class="cfc__empty" aria-hidden="true" />
        </button>
        <span v-else class="cfc__value">{{ text }}</span>
        <Modal
            v-if="asking"
            :modelValue="asking"
            :closeOnBackdrop="false"
            :acceptButtonText="$t('Home.Confirm')"
            :cancelButtonText="$t('Projects.cancel')"
            @accept="confirmReason"
            @close="dropReason"
        >
            <template #header>
                <h3 class="m-0 font-size-16 font-weight-600">{{ $t('TaskPanel.estimate_reason_title') }}</h3>
            </template>
            <template #body>
                <textarea
                    v-model.trim="reason"
                    class="est-cell__reason"
                    :aria-label="$t('TaskPanel.estimate_reason_title')"
                    :placeholder="$t('TaskPanel.estimate_reason_ph')"
                    @input="reasonMissing = false"
                ></textarea>
                <span v-if="reasonMissing" class="est-cell__error">{{ $t('TaskPanel.estimate_reason_required') }}</span>
            </template>
        </Modal>
    </span>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import Modal from "@/components/atom/Modal/Modal.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { fmtEstimate } from "@/components/molecules/Home/homeFormat";
import { parseEstimate } from "@/views/Projects/composables/taskPoints";

defineOptions({ name: "EstimateCell" });

const props = defineProps({
    task: { type: Object, required: true },
    editable: { type: Boolean, default: false }
});
const emit = defineEmits(["change"]);

const { t } = useI18n();
const editing = ref(false);
const draft = ref("");
const input = ref(null);
const trigger = ref(null);
const asking = ref(false);
const reason = ref("");
const reasonMissing = ref(false);
const pending = ref(null);

const previous = computed(() => Number(props.task.totalEstimatedTime) || 0);
const text = computed(() => fmtEstimate(previous.value));
const label = computed(() => {
    const field = t("ViewColumns.estimate_label");
    return text.value ? t("List.cell_change", { field, value: text.value }) : t("List.cell_set", { field });
});

function start() {
    draft.value = text.value;
    editing.value = true;
    nextTick(() => {
        input.value?.focus();
        input.value?.select();
    });
}

function finish() {
    editing.value = false;
    nextTick(() => trigger.value?.focus());
}

/* Changing an estimate that was already set asks why, as the task panel does. */
function commit() {
    if (!editing.value) return;
    const minutes = parseEstimate(draft.value);
    finish();
    if (minutes === null || minutes === previous.value) return;
    if (previous.value > 0) {
        pending.value = minutes;
        reason.value = "";
        reasonMissing.value = false;
        asking.value = true;
        return;
    }
    emit("change", minutes, "");
}

function cancel() {
    if (editing.value) finish();
}

function confirmReason() {
    if (!reason.value) {
        reasonMissing.value = true;
        return;
    }
    asking.value = false;
    emit("change", pending.value, reason.value);
    pending.value = null;
}

function dropReason() {
    asking.value = false;
    pending.value = null;
}
</script>

<style>
.est-cell__input { width: 72px; }
.est-cell__reason {
    width: 100%; min-height: 90px; resize: vertical;
    padding: 8px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--ink); font: inherit;
}
.est-cell__error { color: var(--danger-ink); font-size: 12px; }
</style>
