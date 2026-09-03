<template>
    <section class="pv-roll">
        <header class="pv-roll__head">
            <span class="ah-h3">{{ title }}</span>
        </header>

        <p v-if="error" class="ah-field__error">{{ error }}</p>

        <div v-else-if="!loaded" class="ah-small ah-muted">{{ $t('ProvenanceV2.loading') }}</div>

        <div v-else-if="!data.closed" class="ah-empty">
            <p>{{ $t('ProvenanceV2.empty_title') }}</p>
            <p class="ah-small ah-muted">{{ $t('ProvenanceV2.empty_sub') }}</p>
        </div>

        <template v-else>
            <article class="ah-card pv-roll__card">
                <div class="pv-roll__top">
                    <strong>{{ $t('ProvenanceV2.tasks_closed', { n: data.closed }) }}</strong>
                    <span class="ah-mono pv-roll__points">{{ $t('ProvenanceV2.points', { n: data.completed }) }}</span>
                </div>

                <div class="pv-roll__bar" role="img" :aria-label="barLabel">
                    <span
                        v-for="segment in segments"
                        :key="segment.key"
                        class="pv-roll__seg"
                        :class="`pv-roll__seg--${segment.key}`"
                        :style="{ width: `${segment.width}%` }"
                    ></span>
                </div>

                <div class="pv-roll__legend">
                    <span v-for="segment in segments" :key="`l-${segment.key}`">
                        <i class="pv-roll__swatch" :class="`pv-roll__seg--${segment.key}`"></i>
                        {{ $t(`ProvenanceV2.legend_${segment.key}`) }} {{ segment.tasks }}
                    </span>
                </div>

                <div class="pv-roll__pass">
                    <div v-for="row in firstPass" :key="row.key" class="pv-roll__pass-row">
                        <span class="pv-roll__pass-label">{{ $t(`ProvenanceV2.pass_${row.key}`) }}</span>
                        <span class="pv-roll__track"><i :class="`pv-roll__seg--${row.key}`" :style="{ width: `${row.pct}%` }"></i></span>
                        <span class="ah-mono pv-roll__pass-value">{{ $t('ProvenanceV2.first_pass_value', { pct: row.pct }) }}</span>
                    </div>
                    <p class="ah-small ah-muted pv-roll__note">{{ $t('ProvenanceV2.first_pass_note') }}</p>
                </div>
            </article>

            <article class="ah-card pv-roll__card">
                <strong>{{ $t('ProvenanceV2.downstream') }}</strong>
                <p class="pv-roll__line">{{ $t('ProvenanceV2.velocity_line', { total: data.completed, human: data.completedHuman }) }}</p>
                <p v-if="data.margin && data.margin.hasCostRate" class="pv-roll__line">
                    {{ $t('ProvenanceV2.margin_line', { cost: money(data.margin.costPerClosedTaskMinor.all, symbol), human: money(data.margin.costPerClosedTaskMinor.HUMAN, symbol), agent: money(agentCostPer, symbol) }) }}
                </p>
                <p v-else class="pv-roll__line ah-muted">{{ $t('ProvenanceV2.margin_no_rate') }}</p>
                <p v-if="data.unchecked" class="pv-roll__line pv-roll__line--danger">{{ $t('ProvenanceV2.unchecked_line', { n: data.unchecked }) }}</p>
            </article>

            <p class="pv-roll__why">{{ $t('ProvenanceV2.why') }}</p>
        </template>
    </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { money } from "@/views/Billing/useBilling";
import "./style.css";

// Sprint rollup (29c). Velocity and margin split into what people finished and
// what agents finished, from the same completion records the row badges read.
defineOptions({ name: "ProvenanceRollup" });

const props = defineProps({
    sprintId: { type: String, default: "" },
    projectId: { type: String, default: "" },
    sprintName: { type: String, default: "" }
});

const { t } = useI18n();
const data = ref({});
const loaded = ref(false);
const error = ref("");

const title = computed(() => t("ProvenanceV2.rollup_title", {
    name: props.sprintName || (data.value.sprint && data.value.sprint.name) || t("ProvenanceV2.this_project")
}));

const symbol = computed(() => (data.value.margin && data.value.margin.currencySymbol) || "$");

const segments = computed(() => {
    const byPattern = data.value.byPattern || {};
    const closed = data.value.closed || 1;
    return [
        { key: "human", tasks: (byPattern.HUMAN || {}).tasks || 0 },
        { key: "agent", tasks: (byPattern.AGENT || {}).tasks || 0 },
        { key: "mixed", tasks: (byPattern.MIXED || {}).tasks || 0 },
        { key: "unchecked", tasks: (byPattern.UNCHECKED || {}).tasks || 0 }
    ].map((segment) => ({ ...segment, width: Math.round((segment.tasks / closed) * 1000) / 10 }));
});

const barLabel = computed(() => segments.value.map((s) => `${t(`ProvenanceV2.legend_${s.key}`)} ${s.tasks}`).join(", "));

const firstPass = computed(() => ["agent", "human"]
    .map((key) => ({ key, pct: ((data.value.firstPass || {})[key] || {}).pct }))
    .filter((row) => row.pct !== null && row.pct !== undefined));

const agentCostPer = computed(() => {
    const per = (data.value.margin && data.value.margin.costPerClosedTaskMinor) || {};
    const rows = ["AGENT", "MIXED", "UNCHECKED"].map((key) => per[key]).filter((value) => value !== null && value !== undefined);
    return rows.length ? Math.round(rows.reduce((sum, value) => sum + value, 0) / rows.length) : 0;
});

const load = async () => {
    if (!props.sprintId && !props.projectId) return;
    loaded.value = false;
    error.value = "";
    try {
        const query = props.sprintId ? `sprintId=${props.sprintId}` : `projectId=${props.projectId}`;
        const res = await apiRequest("get", `${env.AGILE_PROVENANCE}?${query}`);
        if (!res?.data?.status) { error.value = res?.data?.statusText || t("ProvenanceV2.load_failed"); return; }
        data.value = res.data.data || {};
    } catch (e) {
        error.value = e?.response?.data?.statusText || e.message;
    } finally {
        loaded.value = true;
    }
};

watch(() => [props.sprintId, props.projectId], load, { immediate: true });
</script>
