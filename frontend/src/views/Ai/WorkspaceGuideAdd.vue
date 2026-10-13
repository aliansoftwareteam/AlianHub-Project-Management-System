<template>
    <div v-if="visible" class="parity-lead">
        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="add">
            {{ busy ? $t('Parity.guide_adding') : $t('Parity.guide_add') }}
        </button>
        <span class="parity-lead">{{ $t('Parity.guide_add_hint') }}</span>
        <p v-if="error" class="ah-field__error">{{ error }}</p>
    </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { reasonOf } from "./useAgents";

defineOptions({ name: "WorkspaceGuideAdd" });

const props = defineProps({
    state: { type: String, default: "" },
    canManage: { type: Boolean, default: false }
});
const emit = defineEmits(["added"]);

const { t } = useI18n();
const $toast = useToast();
const busy = ref(false);
const error = ref("");

const visible = computed(() => props.canManage && props.state === "missing");

const add = async () => {
    busy.value = true;
    error.value = "";
    try {
        const res = await apiRequest("post", env.AGENT_WORKSPACE_GUIDE, {});
        if (!res?.data?.status) throw new Error(res?.data?.statusText || t("Parity.guide_add_failed"));
        if (res.data.data?.created) $toast.success(t("Parity.guide_added"), { position: "top-right" });
        emit("added");
    } catch (e) {
        error.value = reasonOf(e, "Parity.guide_add_failed");
    } finally {
        busy.value = false;
    }
};
</script>
