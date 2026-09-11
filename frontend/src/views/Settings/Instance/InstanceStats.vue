<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!stats" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div class="in-grid">
                <section class="ah-card in-card"><span class="ah-label">{{ $t('Instance.companies') }}</span><strong class="in-big">{{ stats.companies }}</strong></section>
                <section class="ah-card in-card"><span class="ah-label">{{ $t('Instance.users') }}</span><strong class="in-big">{{ stats.users }}</strong></section>
                <section class="ah-card in-card"><span class="ah-label">{{ $t('Instance.version_short') }}</span><strong class="in-big ah-mono" data-test="version-label">{{ stats.version ? `v${stats.version}` : '—' }}</strong><span v-if="buildLine" class="ah-small ah-mono" data-test="version-line">{{ buildLine }}</span></section>
            </div>
            <section class="ah-card in-card">
                <div class="in-card__head"><span class="in-card__title">{{ $t('Instance.companies') }}</span></div>
                <table class="in-table">
                    <thead><tr><th>{{ $t('Instance.company') }}</th><th>{{ $t('Instance.created') }}</th><th></th></tr></thead>
                    <tbody>
                        <tr v-for="c in companies" :key="c._id">
                            <td>{{ c.Cst_CompanyName }} <span class="ah-small ah-mono">{{ c._id }}</span></td>
                            <td>{{ formatWhen(c.createdAt) }}</td>
                            <td><button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="download(`${env.INSTANCE_AUDIT_EXPORT}?companyId=${c._id}`, `audit-${c._id}.csv`)"><ShellIcon name="download" :size="14" />{{ $t('Instance.audit_csv') }}</button></td>
                        </tr>
                    </tbody>
                </table>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceStats" });

const CHANNEL_KEYS = { beta: "Instance.channel_beta", release: "Instance.channel_release", dev: "Instance.channel_dev" };

const { t } = useI18n();
const { get, download, message, env } = useInstanceApi();
const stats = ref(null);
const companies = ref([]);
const error = ref("");

const buildLine = computed(() => {
    const s = stats.value || {};
    const channel = CHANNEL_KEYS[s.channel] ? t(CHANNEL_KEYS[s.channel]) : "";
    return [s.commit ? String(s.commit).slice(0, 8) : "", channel, s.nodeVersion || ""].filter(Boolean).join(" · ");
});

onMounted(async () => {
    try {
        [stats.value, companies.value] = await Promise.all([get(env.INSTANCE_STATS), get(env.INSTANCE_COMPANIES)]);
    } catch (e) {
        error.value = message(e);
    }
});
</script>

<style scoped>
.in-big { font: 600 24px/1.1 var(--font-ui); color: var(--ink); }
</style>
