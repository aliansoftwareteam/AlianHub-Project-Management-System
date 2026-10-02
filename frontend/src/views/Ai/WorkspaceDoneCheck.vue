<template>
    <section class="ah-card" data-test="workspace-done-check" aria-labelledby="acct-done-check-title">
        <div class="ah-card__head">
            <span id="acct-done-check-title" class="ah-h3">{{ $t('Accounts.done_check_title') }}</span>
            <span class="ah-mono acct-note">{{ privileged ? $t('Accounts.policy_you_can_edit') : $t('Accounts.policy_read_only') }}</span>
        </div>
        <div class="ah-card__body">
            <div class="acct-policy">
                <label class="acct-policy__row">
                    <input class="ah-check" type="checkbox" data-test="done-check-switch" :checked="on" :disabled="!privileged || saving" @change="onToggle" />
                    <span>
                        {{ $t('Accounts.done_check_label') }}
                        <small>{{ $t('Accounts.done_check_effect') }}</small>
                    </span>
                </label>
                <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>
                <span v-else-if="saved" class="acct-note" role="status" data-test="done-check-saved">{{ $t('Accounts.policy_saved') }}</span>
            </div>
        </div>
    </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { useAccounts } from "./useAccounts";

defineOptions({ name: "WorkspaceDoneCheck" });

const props = defineProps({
    privileged: { type: Boolean, default: false }
});

const { policy, saveCheckBeforeDone } = useAccounts();

const saving = ref(false);
const saved = ref(false);
const error = ref("");
const on = computed(() => Boolean(policy.value.requireCheckBeforeDone));

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
        await saveCheckBeforeDone(wanted);
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
