<template>
    <section class="hc-card hstand" data-test="standup-card" :aria-label="$t('Home.card_standup')">
        <div class="hc-card__head">
            <span class="hc-card__title">{{ $t('Home.card_standup') }}</span>
            <button type="button" class="hstand__tool" data-test="standup-refresh" :aria-label="$t('Home.standup_refresh')" :title="$t('Home.standup_refresh')" :disabled="loading" @click="load">
                <ShellIcon name="refresh" :size="13" />
            </button>
            <button type="button" class="hstand__tool" data-test="standup-hide" :aria-label="$t('Home.hide_card')" :title="$t('Home.hide_card')" @click="$emit('hide')">
                <ShellIcon name="x" :size="13" />
            </button>
        </div>

        <p v-if="loading && !data" class="hc-hint hstand__state">{{ $t('Home.standup_loading') }}</p>
        <div v-else-if="failed" class="hstand__state" data-test="standup-error">
            <p class="hc-hint">{{ $t('Home.standup_failed') }}</p>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="standup-retry" @click="load">{{ $t('Home.standup_retry') }}</button>
        </div>
        <p v-else-if="isEmpty" class="hc-hint hstand__state" data-test="standup-empty">{{ $t('Home.standup_empty') }}</p>
        <template v-else-if="data">
            <div v-for="section in sections" :key="section.key" class="hstand__section" data-test="standup-section">
                <h3 class="hstand__heading">{{ $t(section.titleKey) }}</h3>
                <p v-if="!section.items.length" class="hstand__none">{{ $t('Home.standup_none') }}</p>
                <ul v-else class="hstand__list">
                    <li v-for="item in section.items" :key="`${item.kind}:${item.task.taskId}`" class="hstand__line">
                        <span class="hstand__kind" :class="`hstand__kind--${item.kind}`">{{ kindLabel(item) }}</span>
                        <button type="button" class="hstand__task" data-test="standup-task" @click="open(item.task)">
                            <b v-if="item.task.taskKey" class="hstand__key">{{ item.task.taskKey }}</b>{{ item.task.taskName }}
                        </button>
                    </li>
                </ul>
                <p v-if="section.more" class="hstand__more">{{ $t('Home.standup_more', { n: section.more }) }}</p>
            </div>
        </template>

        <p class="hstand__source" data-test="standup-source">{{ $t('Home.standup_source') }}</p>
    </section>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { openTask } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";

defineOptions({ name: "StandupCard" });
defineEmits(["hide"]);

const { t } = useI18n();
const companyId = inject("$companyId");

const data = ref(null);
const loading = ref(false);
const failed = ref(false);

const KIND_KEYS = {
    completed: "Home.standup_kind_completed",
    moved: "Home.standup_kind_moved",
    commented: "Home.standup_kind_commented",
    tracking: "Home.standup_kind_tracking",
    due_today: "Home.standup_kind_due_today",
    blocked: "Home.standup_kind_blocked",
};

const kindLabel = (item) => (item.kind === "overdue" ? t("Home.standup_kind_overdue", { n: item.days }) : t(KIND_KEYS[item.kind] || KIND_KEYS.moved));

const sections = computed(() => {
    const d = data.value || {};
    const totals = d.totals || {};
    const section = (key, titleKey) => {
        const items = Array.isArray(d[key]) ? d[key] : [];
        return { key, titleKey, items, more: Math.max(0, Number(totals[key] || 0) - items.length) };
    };
    return [
        section("yesterday", d.since === "friday" ? "Home.standup_since_friday" : "Home.standup_yesterday"),
        section("today", "Home.standup_today"),
        section("blocked", "Home.standup_blocked"),
    ];
});

const isEmpty = computed(() => Boolean(data.value) && sections.value.every((s) => !s.items.length));

async function load() {
    loading.value = true;
    failed.value = false;
    try {
        const res = await apiRequest("get", `${env.AGENT_TEAM_STANDUP}?tz=${new Date().getTimezoneOffset()}`);
        if (!res?.data?.status) throw new Error(res?.data?.statusText || "standup failed");
        data.value = res.data.data || null;
    } catch (error) {
        failed.value = true;
    } finally {
        loading.value = false;
    }
}

const open = (task) => {
    if (!task?.taskId || !task.projectId) return;
    openTask({ companyId: companyId?.value ?? companyId, projectId: task.projectId, sprintId: task.sprintId || "", folderId: task.folderId || "", taskId: task.taskId });
};

onMounted(load);
</script>

<style scoped>
.hstand__tool {
    width: 26px; height: 26px; display: grid; place-items: center; flex: none;
    border: 0; border-radius: var(--r-chip); background: transparent; color: var(--ink-2); cursor: pointer;
}
.hstand__tool:hover { background: var(--surface-hover); color: var(--ink); }
.hstand__tool:focus-visible { outline: none; box-shadow: var(--focus); }
.hstand__tool:disabled { opacity: .5; cursor: default; }
.hstand__state { margin: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.hstand__state p { margin: 0; }
.hstand__section { display: flex; flex-direction: column; gap: 4px; }
.hstand__heading { margin: 0; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-label); }
.hstand__none, .hstand__more { margin: 0; font: 400 12px/1.4 var(--font-ui); color: var(--ink-2); }
.hstand__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.hstand__line { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 3px 0; }
.hstand__kind {
    flex: none; min-width: 64px; padding: 2px 6px; border-radius: var(--r-chip); text-align: center;
    font: var(--text-data); font-size: 10.5px; background: var(--surface-2); color: var(--ink-label);
}
.hstand__kind--completed { background: var(--ok-bg); color: var(--ok-ink); }
.hstand__kind--tracking { background: var(--brand-tint); color: var(--brand); }
.hstand__kind--overdue, .hstand__kind--blocked { background: var(--danger-bg); color: var(--danger-ink); }
.hstand__kind--due_today { background: var(--warn-bg); color: var(--warn-ink); }
.hstand__task {
    flex: 1 1 auto; min-width: 0; border: 0; background: transparent; padding: 2px 0; text-align: left; cursor: pointer;
    font: 400 13px/1.35 var(--font-ui); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hstand__task:hover { color: var(--brand); }
.hstand__task:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 4px; }
.hstand__key { font: var(--text-data); color: var(--brand); margin-right: 6px; }
.hstand__source { margin: 0; font: 400 11.5px/1.4 var(--font-ui); color: var(--ink-2); }
@media (max-width: 767px) {
    .hstand__tool { width: 44px; height: 44px; }
    .hstand__line { min-height: 44px; }
}
</style>
