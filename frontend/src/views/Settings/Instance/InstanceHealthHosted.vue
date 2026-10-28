<template>
    <div>
        <div class="in-actions">
            <span class="ah-chip" :class="health.status === 'ok' ? 'ah-chip--ok' : 'ah-chip--danger'"><span class="ah-dot" :class="health.status === 'ok' ? 'ah-dot--ok' : 'ah-dot--danger'"></span>{{ health.status === 'ok' ? $t('Instance.status_ok') : $t('Instance.status_degraded') }}</span>
            <span class="ah-chip ah-chip--mono">v{{ health.version }}</span>
            <div class="ah-toolbar__spacer"></div>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="$emit('refresh')">{{ $t('Instance.refresh') }}</button>
        </div>
        <div v-if="health.maintenance" class="in-banner in-banner--warn"><ShellIcon name="alert" :size="15" /><span>{{ $t('Instance.managed_maintenance') }}</span></div>

        <div class="in-grid">
            <section v-for="part in parts" :key="part.key" class="ah-card in-card" :data-test="`hosted-part-${part.key}`">
                <div class="in-card__head"><span class="ah-dot" :class="part.ok ? 'ah-dot--ok' : 'ah-dot--danger'"></span><span class="in-card__title">{{ $t(part.label) }}</span></div>
                <p class="ah-small">{{ part.ok ? $t('Instance.managed_part_ok') : $t('Instance.managed_part_down') }}</p>
            </section>
        </div>

        <div class="in-grid">
            <section class="ah-card in-card" data-test="hosted-version">
                <div class="in-card__head"><span class="in-card__title">{{ $t('Instance.version_card') }}</span></div>
                <p>{{ $t('Instance.managed_version', { v: health.version }) }}</p>
                <p class="ah-small">{{ $t('Instance.managed_updates') }}</p>
                <router-link :to="{ name: 'Changelog', params: { cid } }">{{ $t('Instance.managed_whats_new') }}</router-link>
            </section>
            <section class="ah-card in-card" data-test="hosted-backups">
                <div class="in-card__head"><span class="in-card__title">{{ $t('Instance.card_backup') }}</span></div>
                <p>{{ $t('Instance.managed_backups') }}</p>
                <a v-if="health.portalUrl" :href="health.portalUrl" target="_blank" rel="noopener">{{ $t('Instance.managed_backups_download') }}</a>
            </section>
        </div>

        <section class="ah-card in-card">
            <div class="in-card__head"><span class="ah-dot" :class="health.cron.enabled ? 'ah-dot--ok' : 'ah-dot--warn'"></span><span class="in-card__title">{{ $t('Instance.card_cron', { tz: health.cron.tz }) }}</span></div>
            <div v-if="!cronRows.length" class="ah-small">{{ $t('Instance.cron_none_yet') }}</div>
            <table v-else class="in-table">
                <thead><tr><th>{{ $t('Instance.job') }}</th><th>{{ $t('Instance.last_run') }}</th><th>{{ $t('Instance.result') }}</th></tr></thead>
                <tbody>
                    <tr v-for="row in cronRows" :key="row.name">
                        <td class="ah-mono">{{ row.name }}</td>
                        <td>{{ formatWhen(row.lastRunAt) }}</td>
                        <td><span class="ah-chip" :class="row.ok ? 'ah-chip--ok' : 'ah-chip--danger'">{{ row.ok ? $t('Instance.ok') : $t('Instance.failed') }}</span></td>
                    </tr>
                </tbody>
            </table>
        </section>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceHealthHosted" });

const props = defineProps({ health: { type: Object, required: true }, busy: { type: Boolean, default: false } });
defineEmits(["refresh"]);

const cid = inject("$companyId");

const parts = computed(() => [
    { key: "db", label: "Instance.card_db", ok: props.health.db.ok },
    { key: "storage", label: "Instance.card_storage", ok: props.health.storage.ok },
    { key: "mail", label: "Instance.card_mail", ok: props.health.mail.configured && props.health.mail.ok !== false },
    { key: "queue", label: "Instance.card_queue", ok: !props.health.agenda.failed },
]);
const cronRows = computed(() => Object.entries(props.health.cron.jobs || {}).map(([name, v]) => ({ name, ...v })));
</script>
