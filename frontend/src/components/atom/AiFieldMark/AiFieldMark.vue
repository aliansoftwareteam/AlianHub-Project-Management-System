<template>
    <span class="aim" :class="{ 'aim--text': showText }">
        <span class="aim__mark" data-ai-mark :title="tooltip">
            <span aria-hidden="true">✦</span>
            <span :class="showText ? 'aim__text' : 'ah-sr-only'">{{ tooltip }}</span>
        </span>
        <button
            v-if="canFill && aiUsable"
            type="button"
            class="aim__fill"
            data-ai-fill
            :aria-label="$t('AiFields.fill_with_ai')"
            :title="$t('AiFields.fill_with_ai')"
            @click.stop="fill"
        >
            <ShellIcon name="ai" :size="12" aria-hidden="true" />
        </button>
    </span>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { aiUsable } from "@/composable/aiAvailability";
import { openAiFill } from "@/composable/aiFieldFill";
import { aiFillOf } from "@/views/Projects/composables/aiFields";

defineOptions({ name: "AiFieldMark" });

const props = defineProps({
    def: { type: Object, required: true },
    task: { type: Object, required: true },
    canFill: { type: Boolean, default: false },
    showText: { type: Boolean, default: false }
});

const { t } = useI18n();
const dateFormat = inject("$dateFormat", ref("DD/MM/YYYY"));

const tooltip = computed(() => {
    const last = aiFillOf(props.task, props.def);
    const at = last?.at ? moment(last.at) : null;
    if (!at || !at.isValid()) return t("AiFields.ai_field_hint");
    return t(last.trigger === "auto" ? "AiFields.refilled_by_ai" : "AiFields.filled_by_ai", { date: at.format(dateFormat.value) });
});

function fill() {
    if (props.task?._id) openAiFill(props.def, [String(props.task._id)]);
}
</script>

<style>
.aim { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
.aim__mark { color: var(--brand); font-size: 11px; line-height: 1; cursor: default; }
.aim__fill {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; padding: 0;
    border: 0; border-radius: 6px; background: none; color: var(--ink-2); cursor: pointer;
    opacity: 0; transition: opacity var(--t-state, .15s) var(--ease, ease);
}
.aim__fill:hover { background: var(--surface-hover); color: var(--brand); }
.aim__fill:focus-visible { opacity: 1; outline: none; box-shadow: var(--focus); }
[role="row"]:hover .aim__fill, [role="row"]:focus-within .aim__fill, .aim:hover .aim__fill, .aim--text .aim__fill { opacity: 1; }
.aim--text { gap: 6px; }
.aim__text { margin-left: 4px; color: var(--ink-2); font-size: 11.5px; }
@media (max-width: 767px) {
    .aim__fill { opacity: 1; width: 28px; height: 28px; }
}
</style>
