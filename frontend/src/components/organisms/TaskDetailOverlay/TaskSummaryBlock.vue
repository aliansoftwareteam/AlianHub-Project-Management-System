<template>
    <section v-if="visible" class="ah-summary" :class="{ 'is-loading': writing }">
        <div class="ah-summary__head">
            <span class="ah-summary__title">✦ {{ $t('TaskPanel.summary') }}</span>
            <span v-if="meta" class="ah-summary__meta ah-mono">{{ meta }}</span>
            <button
                v-if="summary"
                type="button"
                class="ah-summary__refresh"
                :title="$t('TaskPanel.refresh_summary')"
                :aria-label="$t('TaskPanel.refresh_summary')"
                :disabled="writing"
                @click="write(true)"
            >
                <ShellIcon name="switch" :size="12" />
            </button>
        </div>
        <p v-if="summary" class="ah-summary__text">{{ summary }}</p>
        <p v-else-if="writing" class="ah-summary__text ah-summary__text--muted">{{ $t('TaskPanel.summary_loading') }}</p>
        <p v-if="error" class="ah-summary__text ah-summary__text--muted">{{ error }}</p>
        <p v-else-if="behind" class="ah-summary__text ah-summary__text--muted" data-test="summary-behind">{{ $t('TaskPanel.summary_behind') }}</p>
        <button v-if="offer" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="summary-ask" @click="write(false)">
            {{ $t('TaskPanel.summarise_thread') }}
        </button>
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
const summaryCount = ref(0);
const threadCount = ref(0);
const stale = ref(false);
const updatedAt = ref("");
const writing = ref(false);
const error = ref("");
const unavailable = ref(false);
let reading = false;
let pollHandle = null;

const offer = computed(() => !summary.value && !writing.value && threadCount.value > 0);
const behind = computed(() => Boolean(summary.value) && (stale.value || threadCount.value !== summaryCount.value));
const visible = computed(() => props.enabled && !unavailable.value && Boolean(writing.value || summary.value || error.value || offer.value));
const meta = computed(() => {
    if (!summary.value || !summaryCount.value) return "";
    const when = updatedAt.value ? moment(updatedAt.value).format("H:mm") : "";
    return t("TaskPanel.summary_meta", { n: summaryCount.value, time: when });
});

/* A summary costs a model call, so only `write` asks for one. Opening the task, the poll and a new comment read
   what the server already has, and a thread that has none offers the button instead. */
async function request(body) {
    const taskId = props.taskId;
    error.value = "";
    try {
        const response = await apiRequest("post", env.AI_TASK_SUMMARY, { taskId, ...body });
        if (taskId !== props.taskId) return;
        const payload = response?.data || {};
        if (payload.status === true && payload.data) {
            threadCount.value = Number(payload.data.commentCount) || 0;
            emit("count", threadCount.value);
            if (payload.data.pending) return;
            summary.value = payload.data.summary || "";
            summaryCount.value = Number(payload.data.summaryCount ?? threadCount.value) || 0;
            stale.value = payload.data.stale === true;
            updatedAt.value = payload.data.updatedAt || "";
        } else if (payload.aiState) {
            unavailable.value = true;
        } else {
            error.value = payload.statusText || t("TaskPanel.summary_failed");
        }
    } catch (err) {
        if (taskId === props.taskId) error.value = err?.response?.data?.statusText || t("TaskPanel.summary_failed");
    }
}

async function read() {
    if (!props.enabled || !props.taskId || reading || writing.value) return;
    reading = true;
    await request({ force: false, keptOnly: true });
    reading = false;
}

async function write(force) {
    if (!props.enabled || !props.taskId || writing.value) return;
    writing.value = true;
    await request({ force, keptOnly: false });
    writing.value = false;
}

function startPolling() {
    stopPolling();
    if (props.pollMs > 0) pollHandle = setInterval(read, props.pollMs);
}
function stopPolling() {
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = null;
}

watch(() => props.enabled, (enabled) => {
    if (enabled) read();
});

watch(() => props.taskId, () => {
    summary.value = "";
    summaryCount.value = 0;
    threadCount.value = 0;
    stale.value = false;
    updatedAt.value = "";
    error.value = "";
    unavailable.value = false;
    reading = false;
    writing.value = false;
    read();
});

onMounted(() => {
    read();
    startPolling();
});
onBeforeUnmount(stopPolling);

defineExpose({ refresh: read });
</script>
