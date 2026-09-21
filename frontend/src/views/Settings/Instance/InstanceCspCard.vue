<template>
    <section class="ah-card in-card" data-test="csp-card">
        <div class="in-card__head">
            <span class="in-card__title">{{ $t('ContentSecurity.title') }}</span>
            <span v-if="summary" class="ah-chip" :class="MODE_CHIP[summary.mode]" data-test="csp-mode">{{ $t(`ContentSecurity.mode_${summary.mode}`) }}</span>
        </div>
        <p class="ah-small">{{ $t('ContentSecurity.lead') }}</p>
        <div v-if="error" class="in-banner in-banner--danger" data-test="csp-error"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!summary" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <p class="ah-small" data-test="csp-mode-help">{{ $t('ContentSecurity.mode_help') }} <code class="ah-mono">{{ MODE_KEY }}</code></p>
            <div v-if="!summary.hosts.length" class="ah-empty" data-test="csp-empty">{{ summary.mode === 'off' ? $t('ContentSecurity.off_note') : $t('ContentSecurity.empty', { days: summary.days }) }}</div>
            <template v-else>
                <p class="ah-small" data-test="csp-total">{{ $t('ContentSecurity.total', { n: summary.total, days: summary.days }) }}</p>
                <div class="cs-tables">
                    <table class="in-table">
                        <thead><tr><th>{{ $t('ContentSecurity.col_source') }}</th><th>{{ $t('ContentSecurity.col_directive') }}</th><th>{{ $t('ContentSecurity.col_reports') }}</th><th>{{ $t('ContentSecurity.col_last_seen') }}</th></tr></thead>
                        <tbody>
                            <tr v-for="row in summary.hosts" :key="`${row.blockedHost} ${row.directive}`" data-test="csp-host-row">
                                <td class="ah-mono">{{ row.blockedHost }}</td>
                                <td class="ah-mono">{{ row.directive }}</td>
                                <td>{{ row.count }}</td>
                                <td>{{ formatWhen(row.lastSeen) }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <table class="in-table">
                        <thead><tr><th>{{ $t('ContentSecurity.col_directive') }}</th><th>{{ $t('ContentSecurity.col_reports') }}</th></tr></thead>
                        <tbody>
                            <tr v-for="row in summary.directives" :key="row.directive" data-test="csp-directive-row"><td class="ah-mono">{{ row.directive }}</td><td>{{ row.count }}</td></tr>
                        </tbody>
                    </table>
                </div>
                <p class="ah-small">{{ $t('ContentSecurity.rollout') }} <code class="ah-mono">{{ EXTRA_KEY }}</code></p>
            </template>
            <details class="cs-policy">
                <summary class="ah-small">{{ $t('ContentSecurity.policy') }}</summary>
                <pre class="in-pre" data-test="csp-policy">{{ policyLines }}</pre>
            </details>
        </template>
    </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceCspCard" });

const MODE_KEY = "CSP_MODE";
const EXTRA_KEY = "CSP_EXTRA_<DIRECTIVE>";
const MODE_CHIP = { off: "", report: "ah-chip--warn", enforce: "ah-chip--ok" };

const { get, message, env } = useInstanceApi();
const summary = ref(null);
const error = ref("");
const policyLines = computed(() => summary.value.policy.split("; ").join(";\n"));

onMounted(async () => {
    try {
        summary.value = await get(env.INSTANCE_CSP);
    } catch (e) {
        error.value = message(e);
    }
});
</script>

<style scoped>
.cs-tables { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.cs-policy summary { cursor: pointer; }
.cs-policy .in-pre { margin-top: 8px; }
@media (max-width: 900px) { .cs-tables { grid-template-columns: 1fr; } }
</style>
