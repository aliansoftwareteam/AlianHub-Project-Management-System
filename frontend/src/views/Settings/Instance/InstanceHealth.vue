<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!health" class="ah-empty">{{ $t('InstanceV2.loading') }}</div>
        <template v-else>
            <SetupChecklist class="in-readiness" :company-name="$t('InstanceV2.this_instance')" :steps="readinessSteps" @action="onReadiness" @dismiss="hideReadiness = true" v-if="!hideReadiness && readinessSteps.some((s) => !s.done)" />

            <div class="in-actions">
                <span class="ah-chip" :class="health.status === 'ok' ? 'ah-chip--ok' : 'ah-chip--danger'"><span class="ah-dot" :class="health.status === 'ok' ? 'ah-dot--ok' : 'ah-dot--danger'"></span>{{ health.status === 'ok' ? $t('InstanceV2.status_ok') : $t('InstanceV2.status_degraded') }}</span>
                <span class="ah-chip ah-chip--mono">v{{ health.version }}</span>
                <span class="ah-chip ah-chip--mono">{{ health.nodeVersion }}</span>
                <span class="ah-small">{{ $t('InstanceV2.uptime', { t: uptime }) }}</span>
                <div class="ah-toolbar__spacer"></div>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="load">{{ $t('InstanceV2.refresh') }}</button>
                <button type="button" class="ah-btn ah-btn--sm" :class="health.maintenance ? 'ah-btn--danger' : 'ah-btn--outline'" :disabled="busy" @click="toggleMaintenance">
                    {{ health.maintenance ? $t('InstanceV2.maintenance_off') : $t('InstanceV2.maintenance_on') }}
                </button>
            </div>
            <div v-if="health.maintenance" class="in-banner in-banner--warn"><ShellIcon name="alert" :size="15" /><span>{{ $t('InstanceV2.maintenance_banner') }}</span></div>

            <div class="in-grid">
                <section class="ah-card in-card">
                    <div class="in-card__head"><span class="ah-dot" :class="health.db.ok ? 'ah-dot--ok' : 'ah-dot--danger'"></span><span class="in-card__title">{{ $t('InstanceV2.card_db') }}</span></div>
                    <dl class="in-kv">
                        <dt>{{ $t('InstanceV2.latency') }}</dt><dd class="ah-mono">{{ health.db.latencyMs ?? '—' }} ms</dd>
                        <dt v-if="health.db.error">{{ $t('InstanceV2.error') }}</dt><dd v-if="health.db.error" class="ah-mono">{{ health.db.error }}</dd>
                    </dl>
                </section>
                <section class="ah-card in-card">
                    <div class="in-card__head"><span class="ah-dot" :class="health.storage.ok ? 'ah-dot--ok' : 'ah-dot--danger'"></span><span class="in-card__title">{{ $t('InstanceV2.card_storage') }}</span></div>
                    <dl class="in-kv">
                        <dt>{{ $t('InstanceV2.driver') }}</dt><dd class="ah-mono">{{ health.storage.type }}</dd>
                        <dt v-if="health.storage.freeBytes">{{ $t('InstanceV2.free_space') }}</dt><dd v-if="health.storage.freeBytes">{{ formatBytes(health.storage.freeBytes) }} / {{ formatBytes(health.storage.totalBytes) }}</dd>
                        <dt>{{ $t('InstanceV2.detail') }}</dt><dd>{{ health.storage.detail }}</dd>
                    </dl>
                </section>
                <section class="ah-card in-card">
                    <div class="in-card__head"><span class="ah-dot" :class="mailDot"></span><span class="in-card__title">{{ $t('InstanceV2.card_mail') }}</span></div>
                    <dl class="in-kv">
                        <dt>{{ $t('InstanceV2.provider') }}</dt><dd class="ah-mono">{{ health.mail.provider || $t('InstanceV2.not_configured') }}</dd>
                        <dt v-if="health.mail.detail">{{ $t('InstanceV2.detail') }}</dt><dd v-if="health.mail.detail">{{ health.mail.detail }}</dd>
                    </dl>
                    <div class="in-actions">
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy || !health.mail.configured" @click="load(true)">{{ $t('InstanceV2.test_mail') }}</button>
                        <router-link class="ah-btn ah-btn--ghost ah-btn--sm" :to="{ name: 'InstanceSettings', params: { cid }, query: { group: 'mail' } }">{{ $t('InstanceV2.configure') }}</router-link>
                    </div>
                </section>
                <section class="ah-card in-card">
                    <div class="in-card__head"><span class="ah-dot" :class="health.migrations.pending.length || health.migrations.error ? 'ah-dot--warn' : 'ah-dot--ok'"></span><span class="in-card__title">{{ $t('InstanceV2.card_migrations') }}</span></div>
                    <dl class="in-kv">
                        <dt>{{ $t('InstanceV2.applied') }}</dt><dd class="ah-mono">{{ health.migrations.applied }}</dd>
                        <dt>{{ $t('InstanceV2.pending') }}</dt><dd class="ah-mono">{{ health.migrations.pending.length }}</dd>
                        <dt v-if="health.migrations.error">{{ $t('InstanceV2.error') }}</dt><dd v-if="health.migrations.error" class="ah-mono">{{ health.migrations.error }}</dd>
                    </dl>
                    <router-link v-if="health.migrations.pending.length || health.migrations.error" class="ah-btn ah-btn--outline ah-btn--sm" :to="{ name: 'InstanceUpgrade', params: { cid } }">{{ $t('InstanceV2.open_upgrade') }}</router-link>
                </section>
                <section class="ah-card in-card">
                    <div class="in-card__head"><span class="ah-dot" :class="health.agenda.error || health.agenda.failed ? 'ah-dot--warn' : 'ah-dot--ok'"></span><span class="in-card__title">{{ $t('InstanceV2.card_queue') }}</span></div>
                    <dl class="in-kv">
                        <dt>{{ $t('InstanceV2.driver') }}</dt><dd class="ah-mono">{{ health.agenda.driver }}</dd>
                        <dt v-if="health.agenda.pending !== undefined">{{ $t('InstanceV2.pending') }}</dt><dd v-if="health.agenda.pending !== undefined" class="ah-mono">{{ health.agenda.pending }}</dd>
                        <dt v-if="health.agenda.failed !== undefined">{{ $t('InstanceV2.failed') }}</dt><dd v-if="health.agenda.failed !== undefined" class="ah-mono">{{ health.agenda.failed }}</dd>
                        <dt v-if="health.agenda.error">{{ $t('InstanceV2.error') }}</dt><dd v-if="health.agenda.error" class="ah-mono">{{ health.agenda.error }}</dd>
                    </dl>
                </section>
                <section class="ah-card in-card">
                    <div class="in-card__head"><span class="ah-dot" :class="health.lastBackup ? 'ah-dot--ok' : 'ah-dot--warn'"></span><span class="in-card__title">{{ $t('InstanceV2.card_backup') }}</span></div>
                    <dl class="in-kv">
                        <dt>{{ $t('InstanceV2.last_backup') }}</dt><dd>{{ health.lastBackup ? formatWhen(health.lastBackup.createdAt) : $t('InstanceV2.never') }}</dd>
                        <dt v-if="health.lastBackup">{{ $t('InstanceV2.size') }}</dt><dd v-if="health.lastBackup">{{ formatBytes(health.lastBackup.size) }}</dd>
                    </dl>
                    <router-link class="ah-btn ah-btn--outline ah-btn--sm" :to="{ name: 'InstanceBackups', params: { cid } }">{{ $t('InstanceV2.open_backups') }}</router-link>
                </section>
            </div>

            <section class="ah-card in-card">
                <div class="in-card__head"><span class="ah-dot" :class="health.cron.enabled ? 'ah-dot--ok' : 'ah-dot--warn'"></span><span class="in-card__title">{{ $t('InstanceV2.card_cron', { tz: health.cron.tz }) }}</span></div>
                <div v-if="!health.cron.enabled" class="in-banner in-banner--warn"><ShellIcon name="alert" :size="15" /><span>{{ $t('InstanceV2.cron_disabled') }}</span></div>
                <div v-else-if="!cronRows.length" class="ah-small">{{ $t('InstanceV2.cron_none_yet') }}</div>
                <table v-else class="in-table">
                    <thead><tr><th>{{ $t('InstanceV2.job') }}</th><th>{{ $t('InstanceV2.last_run') }}</th><th>{{ $t('InstanceV2.result') }}</th></tr></thead>
                    <tbody>
                        <tr v-for="row in cronRows" :key="row.name">
                            <td class="ah-mono">{{ row.name }}</td>
                            <td>{{ formatWhen(row.lastRunAt) }}</td>
                            <td><span class="ah-chip" :class="row.ok ? 'ah-chip--ok' : 'ah-chip--danger'">{{ row.ok ? $t('InstanceV2.ok') : row.error }}</span></td>
                        </tr>
                    </tbody>
                </table>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import SetupChecklist from "@/components/molecules/Home/SetupChecklist.vue";
import { useInstanceApi, formatBytes, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceHealth" });

const { t } = useI18n();
const $toast = useToast();
const router = useRouter();
const cid = inject("$companyId");
const { get, post, message, env } = useInstanceApi();

const health = ref(null);
const busy = ref(false);
const error = ref("");
const hideReadiness = ref(false);

const uptime = computed(() => {
    const s = health.value?.uptimeSeconds || 0;
    const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
});
const mailDot = computed(() => (!health.value?.mail.configured ? "ah-dot--warn" : health.value.mail.ok === false ? "ah-dot--danger" : "ah-dot--ok"));
const cronRows = computed(() => Object.entries(health.value?.cron.jobs || {}).map(([name, v]) => ({ name, ...v })));
const readinessSteps = computed(() => {
    const r = health.value?.readiness || {};
    return [
        { key: "mail", done: r.mailConfigured, label: "InstanceV2.ready_mail", cta: "InstanceV2.ready_mail_cta" },
        { key: "storage", done: r.storageChosen, label: "InstanceV2.ready_storage", cta: "InstanceV2.ready_storage_cta" },
        { key: "backup", done: r.backupTaken, label: "InstanceV2.ready_backup", cta: "InstanceV2.ready_backup_cta" },
        { key: "https", done: r.httpsWebUrl, label: "InstanceV2.ready_https", cta: "InstanceV2.ready_https_cta" },
        { key: "migrations", done: r.migrationsClean, label: "InstanceV2.ready_migrations", cta: "InstanceV2.ready_migrations_cta" },
    ];
});

async function load(probeMail = false) {
    busy.value = true;
    error.value = "";
    try {
        health.value = await get(probeMail ? `${env.INSTANCE_HEALTH}?probe=mail` : env.INSTANCE_HEALTH);
        if (probeMail) $toast[health.value.mail.ok ? "success" : "error"](health.value.mail.detail || t("InstanceV2.test_done"));
    } catch (e) {
        error.value = message(e);
    } finally {
        busy.value = false;
    }
}

async function toggleMaintenance() {
    busy.value = true;
    try {
        const on = !health.value.maintenance;
        if (on && !window.confirm(t("InstanceV2.maintenance_confirm"))) return;
        await post(env.INSTANCE_MAINTENANCE, { on });
        await load();
    } catch (e) {
        $toast.error(message(e));
    } finally {
        busy.value = false;
    }
}

function onReadiness(key) {
    const target = { mail: { name: "InstanceSettings", query: { group: "mail" } }, storage: { name: "InstanceSettings", query: { group: "storage" } }, https: { name: "InstanceSettings", query: { group: "general" } }, backup: { name: "InstanceBackups" }, migrations: { name: "InstanceUpgrade" } }[key];
    if (target) router.push({ ...target, params: { cid } });
}

onMounted(load);
</script>

<style scoped>
.in-readiness { margin-bottom: 4px; }
</style>
