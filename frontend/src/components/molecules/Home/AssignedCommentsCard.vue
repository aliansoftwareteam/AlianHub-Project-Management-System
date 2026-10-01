<template>
    <section class="hc-card hc-assigned" :aria-labelledby="headingId" data-test="assigned-comments-card">
        <div class="hc-card__head">
            <h2 :id="headingId" class="hc-card__title hc-assigned__title">{{ $t('Home.assigned_comments') }}</h2>
            <span v-if="items.length" class="ah-mono hc-assigned__count">{{ items.length }}</span>
            <button type="button" class="hc-assigned__hide" data-test="assigned-comments-hide" :aria-label="$t('Home.hide_card')" :title="$t('Home.hide_card')" @click="$emit('hide')">
                <ShellIcon name="x" :size="13" />
            </button>
        </div>
        <p v-if="loading && !items.length" class="hc-hint hc-assigned__hint">{{ $t('Home.assigned_comments_loading') }}</p>
        <p v-else-if="!items.length" class="hc-hint hc-assigned__hint">{{ $t('Home.assigned_comments_empty') }}</p>
        <ul v-else class="hc-assigned__list">
            <li v-for="item in items" :key="item._id" class="hc-assigned__item" data-test="assigned-comment">
                <button type="button" class="hc-assigned__open" @click="open(item)">
                    <span class="hc-assigned__text">{{ snippet(item) }}</span>
                    <span class="hc-assigned__task">{{ item.taskKey ? `${item.taskKey} · ` : '' }}{{ item.taskName || $t('Home.untitled_task') }}</span>
                </button>
                <span class="hc-assigned__from">{{ $t('Home.assigned_by', { name: nameOf(item.assignedBy) }) }}</span>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm hc-assigned__resolve" :disabled="busy === item._id" @click="resolve(item)">{{ $t('Comments.resolve') }}</button>
            </li>
        </ul>
    </section>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useGetterFunctions } from "@/composable";
import { commentPlainText } from "@/utils/commentHtml";
import { loadAssignedToMe, resolveComment } from "@/composable/commentThreads";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "AssignedCommentsCard" });

const emit = defineEmits(["open", "hide"]);
const { t } = useI18n();
const { getUser } = useGetterFunctions();

const items = ref([]);
const loading = ref(false);
const busy = ref("");
const headingId = "home_assigned_comments";

const nameOf = (id) => getUser(id)?.Employee_Name || t("Comments.someone");
const snippet = (item) => {
    const text = commentPlainText(item.message || item.mediaOriginalName || "").trim();
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
};

async function load() {
    loading.value = true;
    try {
        items.value = await loadAssignedToMe();
    } catch (e) {
        items.value = [];
    } finally {
        loading.value = false;
    }
}

function open(item) {
    emit("open", { _id: String(item.taskId), ProjectID: String(item.projectId), sprintId: String(item.sprintId || "") });
}

async function resolve(item) {
    busy.value = item._id;
    try {
        await resolveComment(item, true);
        items.value = items.value.filter((row) => row._id !== item._id);
    } catch (e) {
        load();
    } finally {
        busy.value = "";
    }
}

onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.hc-assigned__title { margin: 0; }
.hc-assigned__count { color: var(--ink-2); font-size: var(--fs-xs, 11px); }
.hc-assigned__hide { width: 26px; height: 26px; display: grid; place-items: center; flex: none; border: 0; border-radius: var(--r-chip); background: transparent; color: var(--ink-2); cursor: pointer; }
.hc-assigned__hide:hover { background: var(--surface-hover); color: var(--ink); }
.hc-assigned__hide:focus-visible { outline: none; box-shadow: var(--focus); }
@media (max-width: 767px) {
    .hc-assigned__hide { width: 44px; height: 44px; }
}
.hc-assigned__hint { margin: 0; }
.hc-assigned__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.hc-assigned__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; border-top: 1px solid var(--hairline); padding-top: 8px; }
.hc-assigned__item:first-child { border-top: 0; padding-top: 0; }
.hc-assigned__open { grid-column: 1; text-align: left; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 2px; min-width: 0; color: var(--ink); }
.hc-assigned__open:focus-visible { outline: 2px solid var(--focus, var(--brand)); outline-offset: 2px; border-radius: 4px; }
.hc-assigned__text { font-size: var(--fs-md, 13px); overflow-wrap: anywhere; }
.hc-assigned__task { font-size: var(--fs-sm, 11.5px); color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hc-assigned__from { grid-column: 1; font-size: var(--fs-sm, 11.5px); color: var(--ink-2); }
.hc-assigned__resolve { grid-column: 2; grid-row: 1 / span 2; }
</style>
