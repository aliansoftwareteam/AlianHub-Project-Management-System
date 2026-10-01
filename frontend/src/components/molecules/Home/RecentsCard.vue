<template>
    <section class="hc-card hrec" data-test="recents-card" :aria-label="$t('Home.card_recents')">
        <div class="hc-card__head">
            <span class="hc-card__title">{{ $t('Home.card_recents') }}</span>
            <button type="button" class="hrec__hide" data-test="recents-hide" :aria-label="$t('Home.hide_card')" :title="$t('Home.hide_card')" @click="$emit('hide')">
                <ShellIcon name="x" :size="13" />
            </button>
        </div>
        <p v-if="state === 'loading'" class="hc-hint hrec__note">{{ $t('Home.recents_loading') }}</p>
        <p v-else-if="state === 'failed'" class="hc-hint hrec__note" data-test="recents-failed">
            {{ $t('Home.recents_failed') }}
            <button type="button" class="hrec__retry" @click="load">{{ $t('Home.recents_retry') }}</button>
        </p>
        <p v-else-if="!items.length" class="hc-hint hrec__note" data-test="recents-empty">{{ $t('Home.recents_empty') }}</p>
        <ul v-else class="hrec__list">
            <li v-for="item in items" :key="`${item.type}:${item.id}`">
                <button type="button" class="hrec__row" data-test="recent-row" :data-type="item.type" @click="openItem(item)">
                    <ShellIcon :name="ICONS[item.type]" :size="14" class="hrec__icon" />
                    <span class="hrec__text">
                        <span class="hrec__title">{{ item.title || $t('Home.recents_untitled') }}</span>
                        <span class="hrec__meta">{{ metaOf(item) }}</span>
                    </span>
                </button>
            </li>
        </ul>
    </section>
</template>

<script setup>
import { inject, onMounted, ref, unref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { recentRoute, toRecentItems } from "./recentItems";

defineOptions({ name: "RecentsCard" });
const emit = defineEmits(["open", "hide"]);

const SHOWN = 8;
const ICONS = Object.freeze({ task: "check", project: "projects", doc: "docs", sprint: "flag" });

const router = useRouter();
const { t } = useI18n();
const companyId = inject("$companyId", "");
const items = ref([]);
const state = ref("loading");

const metaOf = (item) => [item.code, t(`Home.recents_type_${item.type}`), item.type === "project" ? "" : item.projectName].filter(Boolean).join(" · ");

async function load() {
    state.value = "loading";
    try {
        const res = await apiRequest("get", `${env.RECENT_VISITS}?types=all`);
        if (!res?.data?.status) throw new Error(res?.data?.statusText || "Recent visits not read");
        items.value = toRecentItems(res.data.data).slice(0, SHOWN);
        state.value = "ready";
    } catch (error) {
        state.value = "failed";
    }
}

function openItem(item) {
    if (item.type === "task") {
        emit("open", item.task);
        return;
    }
    const to = recentRoute(item, unref(companyId));
    if (to && router.hasRoute(to.name)) router.push(to).catch(() => {});
}

onMounted(load);
</script>

<style scoped>
.hrec__hide {
    width: 26px; height: 26px; display: grid; place-items: center; flex: none;
    border: 0; border-radius: var(--r-chip); background: transparent; color: var(--ink-2); cursor: pointer;
}
.hrec__hide:hover { background: var(--surface-hover); color: var(--ink); }
.hrec__hide:focus-visible { outline: none; box-shadow: var(--focus); }
.hrec__note { margin: 0; }
.hrec__retry { border: 0; background: none; padding: 0; color: var(--brand); font: inherit; font-weight: 600; cursor: pointer; }
.hrec__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.hrec__row {
    width: 100%; display: flex; align-items: center; gap: 10px; padding: 7px 6px; min-width: 0;
    border: 0; border-radius: var(--r-chip); background: transparent; color: var(--ink); text-align: left; cursor: pointer;
}
.hrec__row:hover { background: var(--surface-hover); }
.hrec__row:focus-visible { outline: none; box-shadow: var(--focus); }
.hrec__icon { flex: none; color: var(--ink-2); }
.hrec__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.hrec__title { font: 500 13px/1.35 var(--font-ui); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hrec__meta { font: 400 11.5px/1.3 var(--font-ui); color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 767px) {
    .hrec__row { min-height: 44px; }
    .hrec__hide { width: 44px; height: 44px; }
}
</style>
