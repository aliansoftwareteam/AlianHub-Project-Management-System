<template>
    <section class="pv-roll" :aria-labelledby="headingId">
        <header class="pv-roll__head">
            <h2 :id="headingId" class="pv-roll__title">{{ title }}</h2>
            <span v-if="loaded && closed" class="pv-roll__note">{{ $t('Provenance.tasks_closed', { n: closed }) }}</span>
        </header>

        <p v-if="error" class="pv-roll__error" role="alert">{{ error }}</p>
        <p v-else-if="!loaded" class="pv-roll__muted">{{ $t('Provenance.loading') }}</p>
        <div v-else-if="!closed" class="pv-roll__empty">
            <strong>{{ $t('Provenance.empty_title') }}</strong>
            <span>{{ $t('Provenance.empty_sub') }}</span>
        </div>

        <template v-else>
            <div class="pv-roll__bar" role="img" :aria-label="barLabel">
                <span
                    v-for="row in rows.filter((r) => r.tasks)"
                    :key="row.key"
                    class="pv-roll__seg"
                    :class="`pv-roll__seg--${row.key}`"
                    :style="{ width: `${row.share * 100}%` }"
                ></span>
            </div>

            <ul class="pv-roll__legend">
                <li v-for="row in rows" :key="row.key" class="pv-roll__item" :data-pattern="row.key">
                    <i class="pv-roll__swatch pv-roll__seg" :class="`pv-roll__seg--${row.key}`" aria-hidden="true"></i>
                    <span class="pv-roll__label">{{ $t(`Provenance.legend_${row.key}`) }}</span>
                    <span class="pv-roll__count">{{ row.tasks }}</span>
                    <span class="pv-roll__pct">{{ row.pct }}</span>
                </li>
            </ul>

            <p v-if="data.unchecked" class="pv-roll__line pv-roll__line--danger">{{ $t('Provenance.unchecked_line', { n: data.unchecked }) }}</p>
        </template>
    </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { PATTERNS } from "./provenance";
import "./style.css";

defineOptions({ name: "ProvenanceRollup" });

const props = defineProps({
    sprintId: { type: String, default: "" },
    sprintName: { type: String, default: "" }
});

const { t, locale } = useI18n();
const data = ref({});
const loaded = ref(false);
const error = ref("");
const headingId = `pv-roll-${Math.random().toString(36).slice(2, 8)}`;

const closed = computed(() => Number(data.value.closed) || 0);
const title = computed(() => t("Provenance.rollup_title", {
    name: props.sprintName || data.value.sprint?.name || t("Provenance.this_project")
}));

const percent = computed(() => new Intl.NumberFormat(locale.value, { style: "percent", maximumFractionDigits: 0 }));

const rows = computed(() => PATTERNS.map((pattern) => {
    const tasks = Number(data.value.byPattern?.[pattern]?.tasks) || 0;
    const share = closed.value ? tasks / closed.value : 0;
    return { key: pattern.toLowerCase(), tasks, share, pct: percent.value.format(share) };
}));

const barLabel = computed(() => rows.value
    .map((row) => `${t(`Provenance.legend_${row.key}`)} ${row.tasks} (${row.pct})`)
    .join(", "));

const load = async () => {
    data.value = {};
    error.value = "";
    loaded.value = false;
    if (!props.sprintId) return;
    try {
        const res = await apiRequest("get", `${env.AGILE_PROVENANCE}?sprintId=${encodeURIComponent(props.sprintId)}`);
        if (res?.data?.status) data.value = res.data.data || {};
        else error.value = res?.data?.statusText || t("Provenance.load_failed");
    } catch (e) {
        error.value = t("Provenance.load_failed");
    } finally {
        loaded.value = true;
    }
};

watch(() => props.sprintId, load, { immediate: true });
</script>
