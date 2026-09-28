<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div
                ref="dialog"
                class="ah-card aw ask-build"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ask-doc-title"
                tabindex="-1"
                data-test="doc-dialog"
                @keydown.esc.stop.prevent="$emit('close')"
                @keydown.tab="keepFocus"
            >
                <div class="aw__head">
                    <span id="ask-doc-title" class="ah-h3">{{ $t('Ask.build_doc_title') }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Ask.build_close')" @click="$emit('close')">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>

                <div class="aw__body">
                    <p class="ah-small ask-build__lead">{{ $t('Ask.build_doc_lead') }}</p>
                    <div class="ask-build__where">
                        <label class="ah-field">
                            <span class="ah-label">{{ $t('Ask.build_doc_name') }}</span>
                            <input ref="titleInput" v-model="title" class="ah-input" type="text" maxlength="200" data-test="doc-title" />
                        </label>
                        <label class="ah-field">
                            <span class="ah-label">{{ $t('Ask.build_project') }}</span>
                            <select v-model="projectId" class="ah-input" data-test="doc-project">
                                <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
                            </select>
                        </label>
                    </div>
                    <div class="ask-build__preview ask__answer" :aria-label="$t('Ask.build_doc_preview')" role="region" v-html="preview"></div>
                    <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>
                </div>

                <div class="aw__foot">
                    <span class="ah-small">{{ $t('Ask.build_doc_note') }}</span>
                    <span class="ah-toolbar__spacer"></span>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('close')">{{ $t('Ask.build_cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="doc-create" :disabled="!canSubmit" @click="create">
                        {{ busy ? $t('Ask.build_creating') : $t('Ask.build_doc_create') }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { wrapTab } from "@/composable/useFocusTrap";
import { answerHtml } from "./askMarkdown";
import { answerBlocks, docTitleOf } from "./askComposer";

defineOptions({ name: "AskBuildDoc" });

const props = defineProps({
    answer: { type: String, required: true },
    question: { type: String, default: "" },
    projects: { type: Array, default: () => [] },
    projectId: { type: String, default: "" }
});
const emit = defineEmits(["close", "created"]);

const { t } = useI18n();
const dialog = ref(null);
const titleInput = ref(null);
const title = ref(docTitleOf(props.answer, props.question));
const projectId = ref(props.projectId && props.projects.some((p) => p.id === props.projectId) ? props.projectId : (props.projects[0] || {}).id || "");
const busy = ref(false);
const error = ref("");

const preview = computed(() => answerHtml(props.answer));
const canSubmit = computed(() => Boolean(title.value.trim() && projectId.value && !busy.value));

const create = async () => {
    if (!canSubmit.value) return;
    busy.value = true;
    error.value = "";
    try {
        const res = await apiRequest("post", env.PAGES, {
            title: title.value.trim(),
            projectId: projectId.value,
            contentBlocks: answerBlocks(props.answer),
            createdByAgent: true,
            agentName: t("Ask.build_doc_author")
        });
        const page = res?.data?.status ? res.data.data : null;
        if (!page || !page._id) {
            error.value = t("Ask.build_doc_failed");
            return;
        }
        emit("created", { id: String(page._id), title: page.title || title.value.trim(), projectId: projectId.value });
        emit("close");
    } catch {
        error.value = t("Ask.build_doc_failed");
    } finally {
        busy.value = false;
    }
};

const keepFocus = (event) => wrapTab(event, dialog.value);

onMounted(() => { if (titleInput.value) titleInput.value.focus(); });
</script>

<style>
.ask-build__preview { max-height: 260px; overflow: auto; padding: var(--sp-3); border: 1px solid var(--hairline); border-radius: var(--r-input); background: var(--surface-2); }
</style>
