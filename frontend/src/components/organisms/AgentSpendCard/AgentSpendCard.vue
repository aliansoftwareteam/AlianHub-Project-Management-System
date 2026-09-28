<template>
    <div class="dc-body spend">
        <div class="dc-metric">
            <span class="dc-num dc-num--mono" data-test="spend-total">{{ money(total) }}</span>
            <span class="dc-sub" data-test="spend-cap">{{ capTotal ? $t('Dash.spend_of_caps', { cap: money(capTotal) }) : $t('Dash.spend_no_caps') }}</span>
        </div>

        <div class="spend__rows">
            <div v-for="agent in rows" :key="agent.agentId" class="dc-row spend__row" data-test="spend-row">
                <span class="dc-row__name" :title="agent.name">{{ agent.name }}</span>
                <span
                    class="dc-track"
                    role="img"
                    :aria-label="agent.cap ? $t('Dash.spend_bar_label', { name: agent.name, used: money(agent.usd), cap: money(agent.cap) }) : $t('Dash.spend_bar_uncapped', { name: agent.name, used: money(agent.usd) })"
                >
                    <span class="dc-fill" :class="{ 'dc-fill--danger': agent.over }" :style="{ width: `${agent.pct}%` }"></span>
                </span>
                <span class="dc-row__val" :class="{ 'dc-row__val--danger': agent.over }">{{ money(agent.usd) }}</span>
                <span v-if="agent.over" class="ah-chip ah-chip--danger ah-chip--sm spend__chip" data-test="spend-over">{{ $t('Dash.spend_over_cap') }}</span>
                <span v-if="agent.paused" class="ah-chip ah-chip--sm spend__chip" data-test="spend-paused">{{ $t('Dash.spend_paused') }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { aiOff } from '@/composable/aiAvailability';
import { useCardMeta } from '@/components/organisms/DashboardCard/useCardMeta';

defineOptions({ name: 'AgentSpendCard' });

const props = defineProps({
    cardUID: { type: [String, Number], default: '' },
    componentId: { type: String, default: '' },
    cardData: { type: Object, default: () => ({}) },
    filterData: { type: [Array, Object], default: () => [] },
    refreshTrigger: { type: [Number, String], default: 0 },
    companyUserDetail: { type: Object, default: () => ({}) },
    allProjectsArrayFilter: { type: Array, default: () => [] },
    taskStatusArray: { type: [Array, Object], default: () => ({}) },
});

const { t, locale } = useI18n();
const meta = useCardMeta();
const spend = ref({ agents: [], totalUsd: 0 });

const money = (usd) => {
    try {
        return new Intl.NumberFormat(locale.value || 'en', { style: 'currency', currency: 'USD' }).format(Number(usd) || 0);
    } catch (e) {
        return `$${(Number(usd) || 0).toFixed(2)}`;
    }
};

const total = computed(() => Number(spend.value.totalUsd || 0));
const capTotal = computed(() => (spend.value.agents || []).reduce((sum, a) => sum + Number(a.cap || 0), 0));

/* Closest to its cap first; agents without a cap follow, largest spend first. */
const rows = computed(() => (spend.value.agents || []).map((a) => {
    const usd = Number(a.usd || 0);
    const cap = Number(a.cap || 0);
    const share = cap > 0 ? usd / cap : -1;
    return { ...a, usd, cap, share, over: cap > 0 && usd >= cap, pct: cap > 0 ? Math.min(100, Math.round(share * 100)) : (usd > 0 ? 100 : 0) };
}).sort((a, b) => b.share - a.share || b.usd - a.usd));

const load = async () => {
    if (aiOff.value) {
        spend.value = { agents: [], totalUsd: 0 };
        meta.emptyText = t('Dash.spend_ai_off');
        meta.state = 'empty';
        return;
    }
    meta.emptyText = '';
    meta.state = spend.value.agents.length ? meta.state : 'loading';
    try {
        const res = await apiRequest('get', env.AGENT_SPEND);
        if (!res?.data?.status) throw new Error(res?.data?.statusText || 'spend failed');
        spend.value = { agents: [], totalUsd: 0, ...(res.data.data || {}) };
        meta.note = spend.value.month ? t('Dash.spend_note', { month: spend.value.month }) : '';
        meta.updatedAt = Date.now();
        meta.state = spend.value.agents.length ? 'ready' : 'empty';
    } catch (e) {
        meta.state = 'error';
    }
};

watch(() => props.refreshTrigger, load);
watch(aiOff, load);
onMounted(load);
</script>

<style scoped src="@/components/organisms/DashboardCard/cardBody.css"></style>
<style scoped>
.spend__rows { display: flex; flex-direction: column; gap: 9px; margin-top: 4px; }
.spend__row { flex-wrap: wrap; }
.spend__chip { flex: none; }
</style>
