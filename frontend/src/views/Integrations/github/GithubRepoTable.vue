<template>
    <div class="grt" data-repo-table>
        <span class="ah-label">{{ $t('AppConnections.repo_table_title') }}</span>
        <table v-if="rows.length" class="grt__table">
            <thead>
                <tr>
                    <th scope="col" class="ah-label">{{ $t('AppConnections.repo_table_project') }}</th>
                    <th scope="col" class="ah-label">{{ $t('AppConnections.repo_table_repo') }}</th>
                    <th v-if="canManage" scope="col"><span class="ah-sr-only">{{ $t('AppConnections.repo_remove') }}</span></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="row in rows" :key="`${row.projectId}:${row.repo}`" data-repo-row>
                    <td>{{ row.hidden ? $t('AppConnections.hidden_project') : row.projectName }}</td>
                    <td>
                        <span class="ah-mono">{{ row.repo }}</span>
                        <span v-if="row.lastError && !row.blockedHost" class="grt__error">{{ row.lastError }}</span>
                    </td>
                    <td v-if="canManage" class="grt__end">
                        <button
                            type="button"
                            class="ah-btn ah-btn--ghost ah-btn--sm"
                            :disabled="busy"
                            :aria-label="$t('AppConnections.repo_remove_label', { repo: row.repo, project: row.hidden ? $t('AppConnections.hidden_project') : row.projectName })"
                            data-remove-repo
                            @click="remove(row)"
                        >{{ $t('AppConnections.repo_remove') }}</button>
                    </td>
                </tr>
            </tbody>
        </table>
        <span v-else class="ah-small" data-no-repos>{{ $t('AppConnections.repo_none_mapped') }}</span>
        <span v-if="!canManage && conn.hiddenProjects" class="ah-small">{{ $t('AppConnections.hidden_projects', { count: conn.hiddenProjects }, conn.hiddenProjects) }}</span>
        <p v-if="error" class="grt__error" role="alert">{{ error }}</p>

        <button v-if="canManage && !adding" type="button" class="ah-btn ah-btn--secondary ah-btn--sm grt__add" :disabled="busy" data-add-repo @click="openPicker">
            {{ $t('AppConnections.repo_add') }}
        </button>
        <div v-if="canManage && adding" class="grt__adding">
            <label class="ah-field">
                <span class="ah-label">{{ $t('AppConnections.repo_table_project') }}</span>
                <select v-model="projectId" class="ah-input" data-project-select>
                    <option value="">{{ $t('AppConnections.repo_choose_project') }}</option>
                    <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
            </label>
            <GithubRepoPicker :connection-id="conn.id" :can-save="!!projectId" :saving="busy" @save="add" @cancel="adding = false" @blocked="onBlocked" />
        </div>
    </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import GithubRepoPicker from "./GithubRepoPicker.vue";
import { blockedHostIn } from "./githubEgress";

defineOptions({ name: "GithubRepoTable" });

const props = defineProps({
    conn: { type: Object, required: true },
    projects: { type: Array, default: () => [] },
    canManage: { type: Boolean, default: false },
});
const emit = defineEmits(["changed", "blocked"]);

const { t } = useI18n();

const rows = computed(() => props.conn.repos || []);
const adding = ref(false);
const projectId = ref("");
const busy = ref(false);
const error = ref("");

const openPicker = () => {
    projectId.value = "";
    error.value = "";
    adding.value = true;
};

const onBlocked = (host) => {
    adding.value = false;
    emit("blocked", host);
};

const send = async (run) => {
    busy.value = true;
    error.value = "";
    try {
        const res = await run();
        if (res?.data?.status === false) { error.value = res.data.statusText || t("AppConnections.failed"); return false; }
        emit("changed");
        return true;
    } catch (e) {
        const host = blockedHostIn(e?.response?.data);
        if (host) onBlocked(host);
        else error.value = e?.response?.data?.statusText || t("AppConnections.failed");
        return false;
    } finally {
        busy.value = false;
    }
};

const add = async (repo) => {
    if (await send(() => apiRequest("post", `${env.INTEGRATIONS}/connections/${props.conn.id}/repos`, { repo, projectId: projectId.value }))) adding.value = false;
};

const remove = (row) => send(() => apiRequest("delete", `${env.INTEGRATIONS}/connections/${props.conn.id}/repos/${row.projectId}?repo=${encodeURIComponent(row.repo)}`));

defineExpose({ openPicker });
</script>

<style scoped>
.grt { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; min-width: 0; }
.grt__table { width: 100%; border-collapse: collapse; font: var(--text-small); color: var(--ink); }
.grt__table th { text-align: start; padding: 4px 6px 4px 0; }
.grt__table td { padding: 6px 6px 6px 0; border-top: 1px solid var(--hairline); vertical-align: top; overflow-wrap: anywhere; }
.grt__end { text-align: end; }
.grt__error { display: block; margin: 0; color: var(--danger-ink); font: var(--text-small); }
.grt__adding { display: flex; flex-direction: column; gap: 8px; width: 100%; padding-top: 8px; border-top: 1px solid var(--hairline); }
@media (max-width: 760px) {
    .grt__add, .grt__end .ah-btn { min-height: 40px; }
}
</style>
