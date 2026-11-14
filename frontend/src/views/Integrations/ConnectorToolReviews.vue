<template>
    <section v-if="!quiet || waiting.length || loadError" class="cx-review" :aria-labelledby="titleId" data-test="cx-tool-reviews">
        <h3 :id="titleId" class="ah-h3">{{ $t('Connectors.review.title') }}</h3>
        <p class="ah-small cx-review__lead">{{ $t('Connectors.review.lead') }}</p>

        <p v-if="loadError" class="ah-field__error" role="alert">{{ loadError }}</p>
        <p v-else-if="loading" class="ah-small">{{ $t('Connectors.review.loading') }}</p>
        <p v-else-if="!waiting.length" class="ah-small" data-test="cx-review-empty">{{ $t('Connectors.review.none') }}</p>

        <ul v-else class="cx-review__list" role="list">
            <li v-for="item in waiting" :key="`${item.provider}:${item.tool}`" class="cx-review__row" :data-test="`cx-review-${item.provider}-${item.tool}`">
                <div class="cx-review__what">
                    <span class="cx-review__name">{{ toolName(item) }}</span>
                    <span class="ah-small">
                        {{ providerName(item.provider) }} · {{ $t(`Connectors.detail.kind_${item.kind}`) }}<template v-if="item.seenAt"> · {{ $t('Connectors.review.changed_on', { date: date(item.seenAt) }) }}</template>
                    </span>
                </div>
                <div class="cx-review__actions">
                    <button
                        type="button"
                        class="ah-btn ah-btn--primary ah-btn--sm"
                        :disabled="busy === key(item)"
                        :aria-label="$t('Connectors.review.approve_named', { tool: toolName(item) })"
                        :data-test="`cx-review-approve-${item.tool}`"
                        @click="decide(item, true)"
                    >{{ $t('Connectors.review.approve') }}</button>
                    <button
                        type="button"
                        class="ah-btn ah-btn--secondary ah-btn--sm"
                        :disabled="busy === key(item)"
                        :aria-label="$t('Connectors.review.keep_off_named', { tool: toolName(item) })"
                        :data-test="`cx-review-off-${item.tool}`"
                        @click="decide(item, false)"
                    >{{ $t('Connectors.review.keep_off') }}</button>
                </div>
                <p v-if="errors[key(item)]" class="ah-field__error cx-review__error" role="alert">{{ errors[key(item)] }}</p>
            </li>
        </ul>
        <p class="ah-small cx-review__status" role="status">{{ status }}</p>
    </section>
</template>

<script setup>
import { computed, reactive, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { connectorApi } from "./connectorApi";
import { formatDate, providerLabel } from "./connectorLabels";

defineOptions({ name: "ConnectorToolReviews" });

const CHANGED = "changed";

const props = defineProps({
    providers: { type: Array, default: () => [] },
    quiet: { type: Boolean, default: false }
});
const emit = defineEmits(["reviewed"]);

const { t, te } = useI18n();
const titleId = `cx-review-${useId()}`;
const byProvider = reactive({});
const errors = reactive({});
const loading = ref(false);
const loadError = ref("");
const busy = ref("");
const status = ref("");

const key = (item) => `${item.provider}:${item.tool}`;
const providerName = (id) => providerLabel(t, te, id);
const toolName = (item) => (te(item.label) ? t(item.label) : item.tool);
const date = (value) => formatDate(value);

const waiting = computed(() => props.providers.flatMap((provider) => (byProvider[provider] || [])
    .filter((item) => item.state === CHANGED)
    .map((item) => ({ ...item, provider }))));

const readOne = async (provider) => {
    const out = await connectorApi.toolsToReview(provider);
    byProvider[provider] = out?.tools || [];
};

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        await Promise.all(props.providers.map(readOne));
    } catch (e) {
        loadError.value = e.message || t("Connectors.review.load_failed");
    } finally {
        loading.value = false;
    }
};

const decide = async (item, enabled) => {
    busy.value = key(item);
    errors[key(item)] = "";
    status.value = "";
    try {
        const out = await connectorApi.reviewTool(item.provider, item.tool, enabled);
        byProvider[item.provider] = out?.tools || [];
        status.value = t(enabled ? "Connectors.review.approved" : "Connectors.review.kept_off", { tool: toolName(item) });
        emit("reviewed", { provider: item.provider, tool: item.tool, enabled });
    } catch (e) {
        errors[key(item)] = e.message || t("Connectors.review.failed");
    } finally {
        busy.value = "";
    }
};

watch(() => props.providers.join(","), () => { load(); }, { immediate: true });
</script>

<style scoped>
.cx-review { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cx-review__lead { margin: 0; }
.cx-review__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.cx-review__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 0; border-top: 1px solid var(--hairline); }
.cx-review__row:first-child { border-top: 0; }
.cx-review__what { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cx-review__name { font: 600 13px/1.35 var(--font-ui); color: var(--ink); overflow-wrap: anywhere; }
.cx-review__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cx-review__error { width: 100%; margin: 0; }
.cx-review__status { margin: 0; min-height: 1em; }
</style>
