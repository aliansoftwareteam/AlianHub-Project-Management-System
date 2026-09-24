<template>
    <section v-if="canManage" class="ah-card ai-switch-card" data-test="setting-ai-switch">
        <h2 class="task_priority_wrapper_value">{{ $t('AiAvailability.switch_heading') }}</h2>
        <p class="ai-switch-card__lead">{{ $t('AiAvailability.switch_lead') }}</p>
        <div class="ai-switch-card__row">
            <label class="ai-switch-card__label" for="workspace-ai-switch">
                <span class="font-weight-500">{{ $t('AiAvailability.switch_label') }}</span>
                <span class="ai-switch-card__hint">{{ hint }}</span>
            </label>
            <label class="ai-switch-card__toggle">
                <input
                    id="workspace-ai-switch"
                    type="checkbox"
                    role="switch"
                    class="ah-check"
                    :checked="aiAvailability.workspaceEnabled"
                    :aria-checked="aiAvailability.workspaceEnabled ? 'true' : 'false'"
                    :disabled="busy"
                    @change="onToggle($event.target.checked)"
                />
                <span>{{ aiAvailability.workspaceEnabled ? $t('AiAvailability.switch_on') : $t('AiAvailability.switch_off') }}</span>
            </label>
        </div>
        <p v-if="aiAvailability.state === AI_STATE.OFF_INSTANCE" class="ai-switch-card__note" role="note">{{ $t('AiAvailability.switch_instance_off') }}</p>
    </section>
</template>

<script setup>
import { computed, inject, ref, unref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { isOwnerOrAdmin } from "@/utils/roles";
import { AI_STATE, aiAvailability, loadAiAvailability, setWorkspaceAi } from "@/composable/aiAvailability";

defineOptions({ name: "SettingAiSwitch" });

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const companyId = inject("$companyId", "");

const canManage = computed(() => isOwnerOrAdmin(Number(getters["settings/companyUserDetail"]?.roleType)));
const busy = ref(false);
const hint = computed(() => (aiAvailability.workspaceEnabled ? t("AiAvailability.switch_hint_on") : t("AiAvailability.switch_hint_off")));

async function onToggle(enabled) {
    if (enabled === aiAvailability.workspaceEnabled) return;
    busy.value = true;
    try {
        const res = await setWorkspaceAi(enabled);
        if (res?.data?.status) $toast.success(enabled ? t("AiAvailability.switch_saved_on") : t("AiAvailability.switch_saved_off"));
        else $toast.error(t("AiAvailability.switch_failed"));
    } catch (error) {
        $toast.error(t("AiAvailability.switch_failed"));
    } finally {
        busy.value = false;
    }
}

watch(canManage, (value) => {
    if (value && aiAvailability.state === AI_STATE.UNKNOWN) loadAiAvailability(unref(companyId));
}, { immediate: true });
</script>

<style scoped>
.ai-switch-card { margin-top: 24px; padding: 20px; }
.ai-switch-card__lead { margin: 4px 0 16px; font: var(--text-small); color: var(--ink-2); }
.ai-switch-card__row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding-top: 12px; border-top: 1px solid var(--surface-2); }
.ai-switch-card__label { display: flex; flex-direction: column; gap: 2px; max-width: 70%; color: var(--ink); cursor: pointer; }
.ai-switch-card__hint { font: var(--text-small); color: var(--ink-2); }
.ai-switch-card__toggle { display: inline-flex; align-items: center; gap: 8px; font: var(--text-small); color: var(--ink); cursor: pointer; }
.ai-switch-card__note { margin: 12px 0 0; font: var(--text-small); color: var(--ink-2); }
@media (max-width: 480px) {
    .ai-switch-card__label { max-width: 100%; }
}
</style>
