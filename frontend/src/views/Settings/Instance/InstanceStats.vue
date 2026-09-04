<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!stats" class="ah-empty">{{ $t('InstanceV2.loading') }}</div>
        <template v-else>
            <div class="in-grid">
                <section class="ah-card in-card"><span class="ah-label">{{ $t('InstanceV2.companies') }}</span><strong class="in-big">{{ stats.companies }}</strong></section>
                <section class="ah-card in-card"><span class="ah-label">{{ $t('InstanceV2.users') }}</span><strong class="in-big">{{ stats.users }}</strong></section>
                <section class="ah-card in-card"><span class="ah-label">{{ $t('InstanceV2.version_short') }}</span><strong class="in-big ah-mono">v{{ stats.version }}</strong><span class="ah-small">{{ stats.nodeVersion }}</span></section>
            </div>
            <section class="ah-card in-card">
                <div class="in-card__head"><span class="in-card__title">{{ $t('InstanceV2.companies') }}</span></div>
                <table class="in-table">
                    <thead><tr><th>{{ $t('InstanceV2.company') }}</th><th>{{ $t('InstanceV2.created') }}</th><th></th></tr></thead>
                    <tbody>
                        <tr v-for="c in companies" :key="c._id">
                            <td>{{ c.Cst_CompanyName }} <span class="ah-small ah-mono">{{ c._id }}</span></td>
                            <td>{{ formatWhen(c.createdAt) }}</td>
                            <td><button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="download(`${env.INSTANCE_AUDIT_EXPORT}?companyId=${c._id}`, `audit-${c._id}.csv`)"><ShellIcon name="download" :size="14" />{{ $t('InstanceV2.audit_csv') }}</button></td>
                        </tr>
                    </tbody>
                </table>
            </section>
        </template>
    </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceStats" });

const { get, download, message, env } = useInstanceApi();
const stats = ref(null);
const companies = ref([]);
const error = ref("");

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
