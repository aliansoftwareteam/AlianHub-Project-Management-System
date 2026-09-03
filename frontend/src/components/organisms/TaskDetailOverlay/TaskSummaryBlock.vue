<template>
    <section v-if="visible" class="ah-summary" :class="{ 'is-loading': loading }">
        <div class="ah-summary__head">
            <span class="ah-summary__title">✦ {{ $t('TaskPanel.summary') }}</span>
            <span v-if="meta" class="ah-summary__meta ah-mono">{{ meta }}</span>
            <button
                type="button"
                class="ah-summary__refresh"
                :title="$t('TaskPanel.refresh_summary')"
                :aria-label="$t('TaskPanel.refresh_summary')"
                :disabled="loading"
                @click="load(true)"
            >
                <ShellIcon name="switch" :size="12" />
            </button>
        </div>
        <p v-if="summary" class="ah-summary__text">{{ summary }}</p>
        <p v-else-if="loading" class="ah-summary__text ah-summary__text--muted">{{ $t('TaskPanel.summary_loading') }}</p>
        <p v-else-if="error" class="ah-summary__text ah-summary__text--muted">{{ error }}</p>
    </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "TaskSummaryBlock" });

const props = defineProps({
    taskId: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    pollMs: { type: Number, default: 60000 }
});
const emit = defineEmits(["count"]);

const { t } = useI18n();
const summary = ref("");
const commentCount = ref(0);
const updatedAt = ref("");
const loading = ref(false);
const error = ref("");
const unavailable = ref(false);
let pollHandle = null;

const visible = computed(() => props.enabled && !unavailable.value && (loading.value || summary.value || error.value));
const meta = computed(() => {
    if (!commentCount.value) return "";
    const when = updatedAt.value ? moment(updatedAt.value).format("H:mm") : "";
    return t("TaskPanel.summary_meta", { n: commentCount.value, time: when });
});

async function load(force = false) {
    if (!props.enabled || !props.taskId || loading.value) return;
    loading.value = true;
    error.value = "";
    try {
        const response = await apiRequest("post", env.AI_TASK_SUMMARY, { taskId: props.taskId, force });
        const payload = response?.data || {};
        if (payload.status === true && payload.data) {
            summary.value = payload.data.summary || "";
            commentCount.value = Number(payload.data.commentCount) || 0;
            updatedAt.value = payload.data.updatedAt || "";
            emit("count", commentCount.value);
        } else if (/no LLM provider/i.test(payload.statusText || "")) {
            unavailable.value = true;
        } else {
            error.value = payload.statusText || t("TaskPanel.summary_failed");
        }
    } catch (err) {
        error.value = err?.response?.data?.statusText || t("TaskPanel.summary_failed");
    } finally {
        loading.value = false;
    }
}

function startPolling() {
    stopPolling();
    if (props.pollMs > 0) pollHandle = setInterval(() => load(false), props.pollMs);
}
function stopPolling() {
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = null;
}

watch(() => props.taskId, () => {
    summary.value = "";
    commentCount.value = 0;
    updatedAt.value = "";
    unavailable.value = false;
    load(false);
});

onMounted(() => {
    load(false);
    startPolling();
});
onBeforeUnmount(stopPolling);

defineExpose({ refresh: () => load(false) });
</script>
