<template>
    <div class="grp" data-repo-picker>
        <span class="ah-label">{{ $t('AppConnections.repo_label') }}</span>
        <input v-model="filter" class="ah-input" type="search" :placeholder="$t('AppConnections.repo_filter')" :aria-label="$t('AppConnections.repo_filter')" data-repo-filter />
        <div class="grp__list" data-repo-list>
            <label v-for="r in shown" :key="r.fullName" class="grp__pick">
                <input v-model="picked" type="radio" :name="name" :value="r.fullName" />
                <span>{{ r.fullName }}</span>
            </label>
            <span v-if="loaded && !repos.length" class="ah-small">{{ $t('AppConnections.no_repos') }}</span>
            <span v-else-if="loaded && !shown.length" class="ah-small" data-no-match>{{ $t('AppConnections.no_repo_match') }}</span>
        </div>
        <p v-if="error" class="grp__error" role="alert">{{ error }}</p>
        <div class="grp__actions" data-repo-actions>
            <button v-if="more" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="load(page + 1)">{{ $t('AppConnections.more_repos') }}</button>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || saving || !picked || !canSave" data-repo-save @click="$emit('save', picked)">{{ $t('AppConnections.save') }}</button>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('cancel')">{{ $t('AppConnections.cancel') }}</button>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { blockedHostIn } from "./githubEgress";

defineOptions({ name: "GithubRepoPicker" });

const props = defineProps({
    connectionId: { type: String, required: true },
    canSave: { type: Boolean, default: true },
    saving: { type: Boolean, default: false },
});
const emit = defineEmits(["save", "cancel", "blocked"]);

const { t } = useI18n();

const name = `grp-${Math.random().toString(36).slice(2, 8)}`;
const repos = ref([]);
const page = ref(1);
const more = ref(false);
const loaded = ref(false);
const busy = ref(false);
const picked = ref("");
const filter = ref("");
const error = ref("");

const shown = computed(() => {
    const wanted = filter.value.trim().toLowerCase();
    return wanted ? repos.value.filter((r) => r.fullName.toLowerCase().includes(wanted)) : repos.value;
});

const blocked = (body) => {
    const host = blockedHostIn(body);
    if (host) emit("blocked", host);
    return !!host;
};

const load = async (at) => {
    busy.value = true;
    error.value = "";
    try {
        const res = await apiRequest("get", `${env.INTEGRATIONS}/connections/${props.connectionId}/github-repos?page=${at}`);
        if (blocked(res?.data)) return;
        if (!res?.data?.status) { error.value = res?.data?.statusText || t("AppConnections.failed"); return; }
        const data = res.data.data || {};
        repos.value = at === 1 ? data.repos || [] : [...repos.value, ...(data.repos || [])];
        page.value = data.page || at;
        more.value = !!data.hasMore;
        loaded.value = true;
    } catch (e) {
        if (!blocked(e?.response?.data)) error.value = e?.response?.data?.statusText || t("AppConnections.failed");
    } finally {
        busy.value = false;
    }
};

onMounted(() => load(1));
</script>

<style scoped>
.grp { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.grp__list { max-height: 280px; overflow: auto; display: flex; flex-direction: column; }
.grp__pick { display: flex; align-items: center; gap: 8px; font: var(--text-small); color: var(--ink); min-height: 32px; overflow-wrap: anywhere; }
.grp__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.grp__error { margin: 0; color: var(--danger-ink); font: var(--text-small); }
@media (max-width: 760px) {
    .grp__actions .ah-btn { min-height: 40px; }
}
</style>
