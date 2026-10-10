<template>
    <button v-if="repos.length" type="button" class="pgc" :title="$t('ProjectGithub.chip_title')" data-project-github-chip @click="open">
        <span class="pgc__mark" aria-hidden="true"></span>
        <span class="pgc__label">{{ label }}</span>
    </button>
</template>

<script setup>
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { hasProjectGithubView, loadProjectGithub, projectGithubView } from "@/views/Integrations/github/projectGithub";

defineOptions({ name: "ProjectGithubChip" });

const props = defineProps({ projectId: { type: String, default: "" } });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const repos = computed(() => (props.projectId && projectGithubView(props.projectId)?.repos) || []);
const label = computed(() => (repos.value.length === 1
    ? t("ProjectGithub.chip_one", { repo: repos.value[0].repo })
    : t("ProjectGithub.chip_many", { count: repos.value.length })));

const open = () => router.push({ query: { ...route?.query, tab: "ProjectDetail", section: "github" } });

watch(() => props.projectId, (pid) => { if (pid && !hasProjectGithubView(pid)) loadProjectGithub(pid); }, { immediate: true });
</script>

<style scoped>
.pgc {
    display: inline-flex; align-items: center; gap: 6px; max-width: 220px; min-height: 26px; padding: 0 9px;
    border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--ink-2);
    font: 500 12px/1 var(--font-ui); cursor: pointer;
}
.pgc:hover { background: var(--surface-hover); color: var(--ink); }
.pgc:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.pgc__mark { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-2); flex: none; }
.pgc__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
