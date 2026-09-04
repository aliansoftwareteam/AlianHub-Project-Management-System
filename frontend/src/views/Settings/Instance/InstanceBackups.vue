<template>
    <div>
        <div class="in-actions">
            <label class="ah-small in-inline"><input v-model="includeFiles" type="checkbox" class="ah-check" /> {{ $t('Instance.include_files') }}</label>
            <div class="ah-toolbar__spacer"></div>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="load">{{ $t('Instance.refresh') }}</button>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" @click="create">
                <span v-if="busy && creating" class="ah-spin"></span>{{ creating ? $t('Instance.backing_up') : $t('Instance.backup_now') }}
            </button>
        </div>
        <p class="ah-small">{{ $t('Instance.backups_lead', { dir }) }} <a :href="guide('backup-restore')" target="_blank" rel="noopener">{{ $t('Instance.guide') }}</a></p>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-if="notice" class="in-banner in-banner--ok"><ShellIcon name="check" :size="15" /><span>{{ notice }}</span></div>

        <section class="ah-card in-card">
            <div v-if="!backups.length" class="ah-empty">{{ $t('Instance.no_backups') }}</div>
            <table v-else class="in-table">
                <thead><tr><th>{{ $t('Instance.backup') }}</th><th>{{ $t('Instance.created') }}</th><th>{{ $t('Instance.size') }}</th><th></th></tr></thead>
                <tbody>
                    <tr v-for="b in backups" :key="b.name">
                        <td class="ah-mono">{{ b.name }}</td>
                        <td>{{ formatWhen(b.createdAt) }}</td>
                        <td>{{ formatBytes(b.size) }}</td>
                        <td>
                            <div class="in-actions">
                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="download(`${env.INSTANCE_BACKUPS}/${b.name}/download`, b.name)"><ShellIcon name="download" :size="14" />{{ $t('Instance.download') }}</button>
                                <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" :disabled="busy" @click="askRestore(b)">{{ $t('Instance.restore') }}</button>
                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="remove(b)"><ShellIcon name="trash" :size="14" /></button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </section>

        <section v-if="restoring" class="ah-card in-card in-restore">
            <div class="in-card__head"><ShellIcon name="alert" :size="16" /><span class="in-card__title">{{ $t('Instance.restore_title', { name: restoring.name }) }}</span></div>
            <p class="ah-small">{{ $t('Instance.restore_lead') }}</p>
            <dl v-if="manifest" class="in-kv">
                <dt>{{ $t('Instance.taken') }}</dt><dd>{{ formatWhen(manifest.createdAt) }} · v{{ manifest.appVersion }}</dd>
                <dt>{{ $t('Instance.databases') }}</dt><dd>{{ Object.keys(manifest.databases).length }} ({{ manifest.companies.map((c) => c.name).filter(Boolean).join(', ') || 'global' }})</dd>
                <dt>{{ $t('Instance.files') }}</dt><dd>{{ manifest.includeFiles ? $t('Instance.yes') : $t('Instance.no') }}</dd>
            </dl>
            <div class="ah-field">
                <label class="ah-field__label" for="confirm">{{ $t('Instance.restore_type', { name: restoring.name }) }}</label>
                <input id="confirm" v-model.trim="confirm" type="text" class="ah-input ah-mono" autocomplete="off" />
            </div>
            <div class="in-actions">
                <button type="button" class="ah-btn ah-btn--danger" :disabled="busy || confirm !== restoring.name" @click="restore">
                    <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('Instance.restoring') : $t('Instance.restore_go') }}
                </button>
                <button type="button" class="ah-btn ah-btn--secondary" :disabled="busy" @click="restoring = null">{{ $t('Instance.cancel') }}</button>
            </div>
        </section>
    </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatBytes, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceBackups" });

const { t } = useI18n();
const $toast = useToast();
const { get, post, del, download, message, guide, env } = useInstanceApi();

const backups = ref([]);
const dir = ref("");
const includeFiles = ref(false);
const busy = ref(false);
const creating = ref(false);
const error = ref("");
const notice = ref("");
const restoring = ref(null);
const manifest = ref(null);
const confirm = ref("");

async function load() {
    error.value = "";
    try {
        const data = await get(env.INSTANCE_BACKUPS);
        backups.value = data.backups;
        dir.value = data.dir;
    } catch (e) {
        error.value = message(e);
    }
}

async function create() {
    busy.value = true; creating.value = true; notice.value = ""; error.value = "";
    try {
        const data = await post(env.INSTANCE_BACKUPS, { includeFiles: includeFiles.value });
        notice.value = t("Instance.backup_done", { name: data.name, size: formatBytes(data.size) });
        await load();
    } catch (e) {
        error.value = message(e);
    } finally {
        busy.value = false; creating.value = false;
    }
}

async function askRestore(b) {
    restoring.value = b;
    confirm.value = "";
    manifest.value = null;
    try { manifest.value = await get(`${env.INSTANCE_BACKUPS}/${b.name}/manifest`); } catch (e) { $toast.error(message(e)); }
}

async function restore() {
    busy.value = true; error.value = ""; notice.value = "";
    try {
        const data = await post(`${env.INSTANCE_BACKUPS}/${restoring.value.name}/restore`, { confirm: confirm.value });
        notice.value = t("Instance.restore_done", { docs: data.restored.documents, colls: data.restored.collections, safety: data.safetyBackup });
        restoring.value = null;
        await load();
    } catch (e) {
        error.value = message(e);
    } finally {
        busy.value = false;
    }
}

async function remove(b) {
    if (!window.confirm(t("Instance.delete_confirm", { name: b.name }))) return;
    busy.value = true;
    try { await del(`${env.INSTANCE_BACKUPS}/${b.name}`); await load(); } catch (e) { $toast.error(message(e)); } finally { busy.value = false; }
}

onMounted(load);
</script>

<style scoped>
.in-inline { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.in-restore { border-color: var(--danger); }
</style>
