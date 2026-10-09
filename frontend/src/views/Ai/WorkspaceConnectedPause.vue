<template>
    <section class="ah-card" data-test="workspace-connected-pause" aria-labelledby="acct-connected-pause-title">
        <div class="ah-card__head">
            <span id="acct-connected-pause-title" class="ah-h3">{{ $t('Accounts.connected_pause_title') }}</span>
            <span class="ah-mono acct-note">{{ privileged ? $t('Accounts.policy_you_can_edit') : $t('Accounts.policy_read_only') }}</span>
        </div>
        <div class="ah-card__body">
            <div class="acct-policy">
                <p v-if="on" class="acct-paused" role="status" data-test="connected-paused-now">
                    <span class="ah-chip ah-chip--warn">{{ $t('Ai.connected_paused') }}</span>
                </p>
                <label class="acct-policy__row">
                    <input class="ah-check" type="checkbox" data-test="connected-pause-switch" :checked="on" :disabled="!privileged || saving" @change="onToggle" />
                    <span>
                        {{ $t('Accounts.connected_pause_label') }}
                        <small>{{ $t('Accounts.connected_pause_effect') }}</small>
                    </span>
                </label>
                <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>
                <span v-else-if="saved" class="acct-note" role="status" data-test="connected-pause-saved">{{ $t('Accounts.policy_saved') }}</span>
            </div>
        </div>
    </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { useAccounts } from "./useAccounts";

defineOptions({ name: "WorkspaceConnectedPause" });

const props = defineProps({
    privileged: { type: Boolean, default: false }
});

// The policy is shared with WorkspaceDoneCheck, which reads it again when it changes elsewhere.
const { policy, saveConnectedPaused } = useAccounts();

const saving = ref(false);
const saved = ref(false);
const error = ref("");
const on = computed(() => Boolean(policy.value.connectedPaused));

const onToggle = async (event) => {
    const box = event.target;
    const wanted = box.checked;
    if (!props.privileged) {
        box.checked = on.value;
        return;
    }
    saving.value = true;
    saved.value = false;
    error.value = "";
    try {
        await saveConnectedPaused(wanted);
        saved.value = true;
    } catch (e) {
        error.value = e.message;
    } finally {
        saving.value = false;
        // A refusal leaves `on` as it was, so the binding does not put the box back by itself.
        box.checked = on.value;
    }
};
</script>

<style scoped>
.acct-paused { margin: 0 0 var(--sp-4); }
</style>
