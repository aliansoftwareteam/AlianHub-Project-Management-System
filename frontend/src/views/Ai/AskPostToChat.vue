<!--
  Posts an Ask answer into a channel or a direct message the person can post in. The server decides what
  goes: an answer built with anything some reader of that conversation cannot open is held back, and this
  dialog then offers to post only the lines everyone can open, or to cancel.
-->
<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div
                ref="dialog"
                class="ah-card aw ask-post"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ask-post-title"
                tabindex="-1"
                data-test="post-dialog"
                @keydown.esc.stop.prevent="$emit('close')"
                @keydown.tab="keepFocus"
            >
                <div class="aw__head">
                    <span id="ask-post-title" class="ah-h3">{{ $t('Ask.post_title') }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Ask.build_close')" @click="$emit('close')">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>

                <div class="aw__body">
                    <p class="ah-small">{{ $t('Ask.post_lead') }}</p>
                    <p v-if="loading" class="ah-small" role="status">{{ $t('Ask.post_loading') }}</p>
                    <p v-else-if="!targets.length" class="ah-empty" data-test="post-none">{{ $t(loadFailed ? 'Ask.post_load_failed' : 'Ask.post_none') }}</p>
                    <label v-else class="ah-field">
                        <span class="ah-label">{{ $t('Ask.post_where') }}</span>
                        <select ref="picker" v-model="chosen" class="ah-input" data-test="post-target" :disabled="busy" @change="held = null">
                            <optgroup v-if="channels.length" :label="$t('Ask.post_channels')">
                                <option v-for="target in channels" :key="target.key" :value="target.key">{{ target.label }}</option>
                            </optgroup>
                            <optgroup v-if="directs.length" :label="$t('Ask.post_directs')">
                                <option v-for="target in directs" :key="target.key" :value="target.key">{{ target.label }}</option>
                            </optgroup>
                        </select>
                    </label>

                    <div v-if="held" class="ask-post__held" role="alert" data-test="post-held">
                        <p>{{ $t('Ask.post_held', { n: held.unshared, name: target.label }) }}</p>
                        <p v-if="held.unsharedCited.length" class="ah-small">{{ $t('Ask.post_held_cited', { refs: held.unsharedCited.join(', ') }) }}</p>
                        <p class="ah-small">{{ $t(held.postable ? 'Ask.post_held_choice' : 'Ask.post_nothing_shared') }}</p>
                    </div>
                    <p v-if="error" class="ah-field__error" role="alert" data-test="post-error">{{ error }}</p>
                </div>

                <div class="aw__foot">
                    <span class="ah-toolbar__spacer"></span>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="post-cancel" @click="$emit('close')">{{ $t('Ask.build_cancel') }}</button>
                    <button v-if="held && held.postable" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="post-only-shared" :disabled="busy" @click="send(true)">
                        {{ busy ? $t('Ask.post_posting') : $t('Ask.post_only_shared') }}
                    </button>
                    <button v-else-if="!held" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="post-send" :disabled="!target || busy" @click="send(false)">
                        {{ busy ? $t('Ask.post_posting') : $t('Ask.post_action') }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { wrapTab } from "@/composable/useFocusTrap";

defineOptions({ name: "AskPostToChat" });

const props = defineProps({
    question: { type: String, required: true },
    answer: { type: String, required: true },
    cited: { type: Array, default: () => [] },
    shareToken: { type: String, required: true }
});
const emit = defineEmits(["close", "posted"]);

const { t } = useI18n();
const $toast = useToast();
const dialog = ref(null);
const picker = ref(null);
const loading = ref(true);
const loadFailed = ref(false);
const channels = ref([]);
const directs = ref([]);
const chosen = ref("");
const busy = ref(false);
const held = ref(null);
const error = ref("");

const keyOf = (row) => `${row.projectId}:${row.sprintId}:${row.taskId}`;
const targets = computed(() => [...channels.value, ...directs.value]);
const target = computed(() => targets.value.find((row) => row.key === chosen.value) || null);

const ERROR_KEYS = { share_refused: "Ask.post_expired", nothing_shared: "Ask.post_nothing_shared" };

const load = async () => {
    try {
        const res = await apiRequest("get", env.AI_ASK_POST_TARGETS);
        const data = res?.data?.status ? res.data.data || {} : null;
        loadFailed.value = !data;
        channels.value = ((data && data.channels) || []).map((row) => ({ ...row, key: keyOf(row), label: row.space ? `#${row.name} · ${row.space}` : `#${row.name}` }));
        directs.value = ((data && data.directs) || []).map((row) => ({ ...row, key: keyOf(row), label: row.name }));
    } catch {
        loadFailed.value = true;
    } finally {
        loading.value = false;
        chosen.value = targets.value.length ? targets.value[0].key : "";
        await nextTick();
        (picker.value || dialog.value)?.focus();
    }
};

const send = async (onlyShared) => {
    if (!target.value || busy.value) return;
    busy.value = true;
    error.value = "";
    try {
        const { projectId, sprintId, taskId, label } = target.value;
        const res = await apiRequest("post", env.AI_ASK_POST, {
            projectId, sprintId, taskId,
            question: props.question,
            answer: props.answer,
            cited: props.cited,
            shareToken: props.shareToken,
            ...(onlyShared ? { onlyShared: true } : {})
        });
        const body = res?.data || {};
        if (body.status === true) {
            $toast.success(t("Ask.post_done", { name: label }), { position: "top-right" });
            emit("posted", { ...target.value, id: body.data && body.data.id });
            emit("close");
            return;
        }
        if (body.code === "not_shared" && body.data) {
            held.value = { unshared: Number(body.data.unshared) || 0, unsharedCited: body.data.unsharedCited || [], postable: body.data.postable === true };
            return;
        }
        error.value = t(ERROR_KEYS[body.code] || "Ask.post_failed");
    } catch (failure) {
        const code = failure?.response?.data?.code;
        error.value = t(ERROR_KEYS[code] || "Ask.post_failed");
    } finally {
        busy.value = false;
    }
};

const keepFocus = (event) => wrapTab(event, dialog.value);

onMounted(load);
</script>

<style>
@import "./style.css";
.ask-post__held { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: var(--r-input); background: var(--warn-bg); color: var(--warn-ink); font: var(--text-small); }
.ask-post__held p { margin: 0; }
</style>
