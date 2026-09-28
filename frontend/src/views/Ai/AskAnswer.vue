<template>
    <section class="ah-card ask-answer" :aria-busy="streaming ? 'true' : 'false'">
        <div class="ah-card__head">
            <span class="ah-h3">{{ answer.mode === 'research' ? $t('Parity.report') : $t('Parity.answer') }}</span>
            <span v-if="answer.usage && answer.usage.model" class="parity-count">{{ answer.usage.model }}</span>
        </div>
        <div class="ah-card__body">
            <div class="ask__answer" @click="followCite" v-html="html"></div>
            <p v-if="streaming" class="ah-small ask__streaming">{{ $t('Ask.answering') }}</p>
            <template v-else>
                <div v-if="cited.length || gone.length" class="ask__cites">
                    <div class="ah-label">{{ $t('Parity.cited') }}</div>
                    <div v-for="source in cited" :key="source.ref" class="ask__cite">
                        <router-link v-if="linkOf(source)" :to="linkOf(source)" class="ask__cite-ref">{{ source.ref }}</router-link>
                        <span v-else class="ask__cite-ref">{{ source.ref }}</span>
                        <span>{{ source.title }}<span v-if="source.project" class="ah-muted"> · {{ source.project }}</span></span>
                    </div>
                    <div v-for="source in gone" :key="`gone-${source.ref}`" class="ask__cite ask__cite--gone" data-test="ask-cite-gone">
                        <span class="ask__cite-ref">{{ source.ref }}</span>
                        <span class="ah-muted">{{ $t('Ask.cite_unavailable') }}</span>
                    </div>
                </div>
                <div class="ask__why">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="ask-copy" @click="copy">
                        <ShellIcon name="copy" :size="13" />{{ $t('Ask.copy') }}
                    </button>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="ask-make-task" @click="makeTask">
                        <ShellIcon name="plus" :size="13" />{{ $t('Ask.make_task') }}
                    </button>
                    <button
                        v-if="workItems.length > 1"
                        type="button"
                        class="ah-btn ah-btn--secondary ah-btn--sm"
                        aria-haspopup="dialog"
                        ref="tasksOpener"
                        data-test="ask-build-tasks"
                        @click="building = 'tasks'"
                    >
                        <ShellIcon name="check" :size="13" />{{ $t('Ask.build_tasks_open', { n: workItems.length }) }}
                    </button>
                    <button ref="docOpener" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" aria-haspopup="dialog" data-test="ask-build-doc" @click="building = 'doc'">
                        <ShellIcon name="docs" :size="13" />{{ $t('Ask.build_doc_open') }}
                    </button>
                    <button
                        ref="opener"
                        type="button"
                        class="ah-btn ah-btn--secondary ah-btn--sm"
                        aria-haspopup="dialog"
                        :aria-expanded="open ? 'true' : 'false'"
                        data-test="why-open"
                        @click="open = true"
                    >
                        <ShellIcon name="shield" :size="13" />{{ $t('Ask.why_open') }}
                    </button>
                </div>
                <p v-if="builtDoc" class="ah-small ask__built" data-test="ask-doc-link">
                    {{ $t('Ask.build_doc_saved') }}
                    <router-link :to="{ name: 'PageEditor', params: { cid: unref(companyId), pageId: builtDoc.id } }">{{ builtDoc.title }}</router-link>
                </p>
                <AiFeedback v-if="answer.turnId" class="ask__feedback" feature="ask" kind="ask_turn" :item-id="answer.turnId" :answer="answer.answer || ''" />
            </template>
        </div>
        <AskWhyPanel v-if="open" :sources="sources" :cited="cited.map((source) => source.ref)" :privileged="privileged" @close="close" />
        <AskBuildTasks v-if="building === 'tasks'" :items="workItems" :projects="projects" :project-id="buildProjectId" @close="closeBuild" />
        <AskBuildDoc
            v-if="building === 'doc'"
            :answer="String(answer.answer || '')"
            :question="String(answer.question || '')"
            :projects="projects"
            :project-id="buildProjectId"
            @created="docCreated"
            @close="closeBuild"
        />
    </section>
</template>

<script setup>
import { computed, getCurrentInstance, inject, nextTick, ref, unref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { openQuickCreate, saveDraft } from "@/components/organisms/QuickCreateTask/quickCreateTask";
import AiFeedback from "@/components/molecules/AiFeedback/AiFeedback.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { showUndoToast } from "@/composable/useUndoToast";
import AskWhyPanel from "./AskWhyPanel.vue";
import AskBuildTasks from "./AskBuildTasks.vue";
import AskBuildDoc from "./AskBuildDoc.vue";
import { workItemsOf } from "./askComposer";
import { sourceLink } from "./askWhy";
import { answerHtml, taskTitleOf } from "./askMarkdown";

defineOptions({ name: "AskAnswer" });

const props = defineProps({
    answer: { type: Object, required: true },
    streaming: { type: Boolean, default: false },
    projects: { type: Array, default: () => [] },
    projectId: { type: String, default: "" }
});

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId", "");
const router = getCurrentInstance()?.proxy?.$router || null;
const linkOf = (source) => sourceLink(source, unref(companyId));

const open = ref(false);
const opener = ref(null);
const building = ref("");
const tasksOpener = ref(null);
const docOpener = ref(null);
const builtDoc = ref(null);

const sources = computed(() => (Array.isArray(props.answer.sources) ? props.answer.sources.filter(Boolean) : []));
const privileged = computed(() => Boolean(props.answer.scope && props.answer.scope.privileged));

const cited = computed(() => {
    const retrieved = new Set(sources.value.map((source) => source.ref).filter(Boolean));
    return (props.answer.cited || []).filter((source) => source && retrieved.has(source.ref));
});

const gone = computed(() => (props.answer.cited || []).filter((source) => source && source.available === false));

const hrefOf = (source) => {
    const to = linkOf(source);
    if (!to || !router) return "";
    try {
        return router.resolve(to).href || "";
    } catch {
        return "";
    }
};

const html = computed(() => answerHtml(props.answer.answer, { cited: props.streaming ? [] : cited.value, hrefOf }));

const followCite = (event) => {
    const link = event.target && typeof event.target.closest === "function" ? event.target.closest("a.ask-cite") : null;
    if (!link || !router || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    const source = cited.value.find((s) => s.ref === link.getAttribute("data-cite"));
    const to = source && linkOf(source);
    if (!to) return;
    event.preventDefault();
    router.push(to);
};

const copy = async () => {
    try {
        await navigator.clipboard.writeText(String(props.answer.answer || ""));
        $toast.success(t("Ask.copied"), { position: "top-right" });
    } catch {
        $toast.error(t("Ask.copy_failed"), { position: "top-right" });
    }
};

const makeTask = () => {
    saveDraft(taskTitleOf(props.answer.answer));
    const inProject = cited.value.find((source) => source.projectId);
    openQuickCreate({ projectId: inProject ? inProject.projectId : "" });
};

const workItems = computed(() => (props.streaming ? [] : workItemsOf(props.answer.answer)));

/* The scoped project, else the one the answer cites most. */
const buildProjectId = computed(() => {
    if (props.projectId) return props.projectId;
    const counts = {};
    cited.value.forEach((source) => { if (source.projectId) counts[source.projectId] = (counts[source.projectId] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "";
});

const closeBuild = async () => {
    const opener = building.value === "tasks" ? tasksOpener.value : docOpener.value;
    building.value = "";
    await nextTick();
    if (opener) opener.focus();
};

const docCreated = (page) => {
    builtDoc.value = page;
    showUndoToast({
        message: t("Ask.build_doc_created"),
        undo: async () => {
            try {
                const res = await apiRequest("delete", `${env.PAGES}/${encodeURIComponent(page.id)}`);
                if (res?.data?.status === false) throw new Error(res.data.statusText);
                if (builtDoc.value && builtDoc.value.id === page.id) builtDoc.value = null;
                $toast.success(t("Ask.build_doc_undone"), { position: "top-right" });
            } catch {
                $toast.error(t("Ask.build_undo_failed"), { position: "top-right" });
            }
        }
    });
};

const close = async () => {
    open.value = false;
    await nextTick();
    if (opener.value) opener.value.focus();
};
</script>

<style>
.ask__why { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.ask__feedback { margin-top: 10px; }
.ask__answer { line-height: 1.55; overflow-wrap: anywhere; }
.ask__answer > :first-child { margin-top: 0; }
.ask__answer > :last-child { margin-bottom: 0; }
.ask__answer p, .ask__answer ul, .ask__answer ol, .ask__answer pre, .ask__answer blockquote { margin: 0 0 8px; }
.ask__answer ul, .ask__answer ol { padding-left: 20px; }
.ask__answer li > p { margin: 0; }
.ask__answer li > ul, .ask__answer li > ol { margin: 0; }
.ask__answer h1, .ask__answer h2, .ask__answer h3, .ask__answer h4 { font-size: 14px; font-weight: 600; margin: 12px 0 6px; }
.ask__answer pre { overflow-x: auto; padding: 8px; border-radius: 6px; background: var(--fill); }
.ask__answer code { font-family: var(--font-mono, monospace); font-size: 12px; }
.ask__answer blockquote { padding-left: 10px; border-left: 2px solid var(--border); color: var(--ink-2); }
.ask__answer a { color: var(--brand); }
.ask__answer .ask-cite { font-family: var(--font-mono, monospace); font-size: 12px; }
.ask__streaming { margin-top: 8px; color: var(--ink-2); }
.ask__cite--gone .ask__cite-ref { color: var(--ink-2); }
.ask__built { margin: 8px 0 0; }
.ask__built a { color: var(--brand); }
</style>
