<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!info" class="ah-empty">{{ $t('InstanceV2.loading') }}</div>
        <template v-else>
            <div class="in-grid">
                <section class="ah-card in-card">
                    <div class="in-card__head"><span class="in-card__title">{{ $t('InstanceV2.version_card') }}</span><span class="ah-chip ah-chip--mono">v{{ info.currentVersion }}</span></div>
                    <div v-if="info.updateAvailable" class="in-banner in-banner--warn"><ShellIcon name="alert" :size="15" /><span>{{ $t('InstanceV2.update_available', { v: info.latest.version }) }} <a :href="info.latest.url" target="_blank" rel="noopener">{{ $t('InstanceV2.release_notes') }}</a></span></div>
                    <div v-else-if="info.latest && info.latest.version" class="in-banner in-banner--ok"><ShellIcon name="check" :size="15" /><span>{{ $t('InstanceV2.up_to_date') }}</span></div>
                    <div v-else class="ah-small">{{ $t('InstanceV2.latest_unknown', { err: info.latest?.error || '' }) }}</div>
                    <ol class="in-steps">
                        <li v-for="(step, i) in steps" :key="i"><code v-if="step.cmd" class="ah-mono">{{ step.cmd }}</code><span v-else>{{ step.text }}</span></li>
                    </ol>
                    <a :href="guide('upgrade')" target="_blank" rel="noopener" class="ah-small">{{ $t('InstanceV2.guide') }}</a>
                </section>

                <section class="ah-card in-card">
                    <div class="in-card__head"><span class="ah-dot" :class="info.migrations.pending.length || info.migrations.failed.length ? 'ah-dot--warn' : 'ah-dot--ok'"></span><span class="in-card__title">{{ $t('InstanceV2.card_migrations') }}</span></div>
                    <dl class="in-kv">
                        <dt>{{ $t('InstanceV2.applied') }}</dt><dd class="ah-mono">{{ info.migrations.applied.length }}</dd>
                        <dt>{{ $t('InstanceV2.pending') }}</dt><dd class="ah-mono">{{ info.migrations.pending.map((m) => m.id).join(', ') || '—' }}</dd>
                        <dt>{{ $t('InstanceV2.auto') }}</dt><dd>{{ info.migrations.auto ? $t('InstanceV2.on') : $t('InstanceV2.off') }}</dd>
                        <dt v-if="info.migrations.error">{{ $t('InstanceV2.error') }}</dt><dd v-if="info.migrations.error" class="ah-mono">{{ info.migrations.error }}</dd>
                    </dl>
                    <div v-for="f in info.migrations.failed" :key="f.id" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span><strong class="ah-mono">{{ f.id }}</strong> {{ f.error }}</span></div>
                    <div class="in-actions">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !info.migrations.pending.length" @click="runMigrations">
                            <span v-if="busy" class="ah-spin"></span>{{ $t('InstanceV2.run_pending') }}
                        </button>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="load">{{ $t('InstanceV2.refresh') }}</button>
                    </div>
                    <table v-if="info.migrations.applied.length" class="in-table">
                        <thead><tr><th>{{ $t('InstanceV2.migration') }}</th><th>{{ $t('InstanceV2.applied_at') }}</th><th>{{ $t('InstanceV2.version_short') }}</th></tr></thead>
                        <tbody>
                            <tr v-for="m in info.migrations.applied" :key="m.id"><td class="ah-mono">{{ m.id }}</td><td>{{ formatWhen(m.appliedAt) }}</td><td class="ah-mono">{{ m.appVersion }}</td></tr>
                        </tbody>
                    </table>
                </section>
            </div>

            <section v-if="info.releases.length" class="ah-card in-card">
                <div class="in-card__head"><span class="in-card__title">{{ $t('InstanceV2.newer_releases', { n: info.releases.length }) }}</span><span v-if="info.upgradeNeedsHands" class="ah-chip ah-chip--warn">{{ $t('InstanceV2.needs_hands') }}</span></div>
                <div v-for="r in info.releases" :key="r.version" class="in-release">
                    <div class="in-card__head"><strong class="ah-mono">v{{ r.version }}</strong><span class="ah-small">{{ r.date }}</span><span v-if="r.selfHost.breaking" class="ah-chip ah-chip--danger">{{ $t('InstanceV2.breaking') }}</span></div>
                    <ul v-if="r.selfHost.notes.length" class="in-notes"><li v-for="(n, i) in r.selfHost.notes" :key="i" v-html="n"></li></ul>
                    <span v-else class="ah-small">{{ $t('InstanceV2.plain_upgrade') }}</span>
                </div>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceUpgrade" });

const { t } = useI18n();
const $toast = useToast();
const { get, post, message, guide, env } = useInstanceApi();

const info = ref(null);
const busy = ref(false);
const error = ref("");

const steps = computed(() => (info.value?.docker
    ? [{ text: t("InstanceV2.step_backup") }, { cmd: "docker compose pull" }, { cmd: "docker compose up -d" }, { text: t("InstanceV2.step_verify") }]
    : [{ text: t("InstanceV2.step_backup") }, { cmd: "git pull && npm ci && (cd frontend && npm ci && npm run build)" }, { cmd: "npm run migrate && npm start" }, { text: t("InstanceV2.step_verify") }]));

async function load() {
    error.value = "";
    try { info.value = await get(env.INSTANCE_UPGRADE); } catch (e) { error.value = message(e); }
}

async function runMigrations() {
    busy.value = true;
    try {
        const data = await post(env.INSTANCE_MIGRATIONS_RUN);
        $toast[data.failed ? "error" : "success"](data.failed ? `${data.failed.id}: ${data.failed.error}` : t("InstanceV2.migrations_done", { n: data.applied.length }));
        await load();
    } catch (e) {
        $toast.error(message(e));
    } finally {
        busy.value = false;
    }
}

onMounted(load);
</script>

<style scoped>
.in-steps { margin: 4px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font: var(--text-small); color: var(--ink); }
.in-steps code { padding: 2px 6px; border-radius: 4px; background: var(--surface-hover); }
.in-release { padding: 10px 0; border-top: 1px solid var(--hairline); display: flex; flex-direction: column; gap: 6px; }
.in-notes { margin: 0; padding-left: 18px; font: var(--text-small); color: var(--ink); }
</style>
