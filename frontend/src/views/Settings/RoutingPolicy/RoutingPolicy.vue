<template>
    <div class="ah-page rp">
        <div class="rp__body ah-scroll">
            <section v-if="privileged" class="ah-card rp__card" data-test="routing-policy">
                <div class="rp__head">
                    <span class="rp__title">{{ $t('Routing.title') }}</span>
                </div>
                <p class="ah-small rp__lead">{{ $t('Routing.lead') }}</p>
                <div v-if="error" class="rp__banner rp__banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
                <div v-else-if="!loaded" class="ah-empty">{{ $t('Routing.loading') }}</div>
                <template v-else>
                    <div v-if="!routerEnabled" class="rp__banner rp__banner--warn" data-test="router-off">
                        <ShellIcon name="alert" :size="15" /><span>{{ $t('Routing.flag_off') }}</span>
                    </div>
                    <div v-if="!models.length" class="rp__banner rp__banner--warn" data-test="models-empty">
                        <ShellIcon name="alert" :size="15" /><span>{{ $t('Routing.no_models') }}</span>
                    </div>

                    <div v-for="row in rows" :key="row.taskClass" class="rp__field" :data-test="`class-${row.taskClass}`">
                        <div>
                            <span class="rp__label">{{ $t(`Routing.class_${row.taskClass}`) }}</span>
                            <div class="rp__help">{{ $t(`Routing.class_${row.taskClass}_help`) }}</div>
                            <div class="rp__help ah-mono">{{ $t('Routing.input_budget', { tokens: row.inputBudgetTokens }) }}</div>
                        </div>
                        <div class="rp__control">
                            <label class="ah-small" :for="`rp-model-${row.taskClass}`">{{ $t('Routing.model') }}</label>
                            <select :id="`rp-model-${row.taskClass}`" v-model="row.model" class="ah-input" :data-test="`model-${row.taskClass}`">
                                <option value="">{{ $t('Routing.model_inherit') }}</option>
                                <option v-for="m in models" :key="m.model" :value="m.model">{{ m.model }} · {{ m.provider }}</option>
                            </select>

                            <label class="ah-small" :for="`rp-quality-${row.taskClass}`">{{ $t('Routing.quality_floor') }}</label>
                            <select :id="`rp-quality-${row.taskClass}`" v-model="row.qualityFloor" class="ah-input" :data-test="`quality-${row.taskClass}`">
                                <option v-for="q in QUALITY" :key="q" :value="q">{{ $t(`Routing.quality_${q}`) }}</option>
                            </select>

                            <label class="ah-small" :for="`rp-latency-${row.taskClass}`">{{ $t('Routing.latency_target') }}</label>
                            <input :id="`rp-latency-${row.taskClass}`" v-model.number="row.latencyTargetMs" type="number" min="250" max="600000" step="250" class="ah-input" :data-test="`latency-${row.taskClass}`" />
                        </div>
                    </div>

                    <div class="rp__actions">
                        <div class="ah-toolbar__spacer"></div>
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !dirty" data-test="save-routing" @click="save">{{ busy ? $t('Routing.saving') : $t('Routing.save') }}</button>
                    </div>
                </template>
            </section>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { reasonOf } from "@/views/Ai/useAgents";
import { isOwnerOrAdmin } from "@/utils/roles";

defineOptions({ name: "RoutingPolicy" });

const QUALITY = ["basic", "standard", "high", "frontier"];

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();

const loaded = ref(false);
const busy = ref(false);
const error = ref("");
const rows = ref([]);
const models = ref([]);
const routerEnabled = ref(false);
let baseline = "";

const privileged = computed(() => isOwnerOrAdmin(Number(getters["settings/companyUserDetail"]?.roleType)));
const snapshot = () => JSON.stringify(rows.value.map((r) => [r.taskClass, r.model, r.qualityFloor, r.latencyTargetMs]));
const dirty = computed(() => snapshot() !== baseline);

const unwrap = (res) => {
    if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t("Routing.load_failed"));
    return res.data.data || {};
};

function seed(policy) {
    rows.value = (policy.classes || []).map((c) => ({
        taskClass: c.taskClass,
        model: c.model || "",
        qualityFloor: c.qualityFloor,
        latencyTargetMs: c.latencyTargetMs,
        inputBudgetTokens: c.inputBudgetTokens,
    }));
    routerEnabled.value = policy.routerEnabled === true;
    baseline = snapshot();
}

async function load() {
    if (!privileged.value) return;
    error.value = "";
    try {
        const [policyRes, modelsRes] = await Promise.all([
            apiRequest("get", env.AGENT_ROUTING_POLICY),
            apiRequest("get", `${env.AGENT_MODELS}?configured=true`),
        ]);
        seed(unwrap(policyRes));
        models.value = unwrap(modelsRes).models || [];
        loaded.value = true;
    } catch (e) {
        error.value = reasonOf(e, "Routing.load_failed");
    }
}

async function save() {
    busy.value = true;
    try {
        const classes = Object.fromEntries(rows.value.map((r) => [r.taskClass, { model: r.model || "", qualityFloor: r.qualityFloor, latencyTargetMs: r.latencyTargetMs }]));
        seed(unwrap(await apiRequest("put", env.AGENT_ROUTING_POLICY, { classes })));
        $toast.success(t("Routing.saved"));
    } catch (e) {
        $toast.error(reasonOf(e, "Routing.save_failed"));
    } finally {
        busy.value = false;
    }
}

onMounted(load);
</script>

<style scoped>
.rp { background: var(--canvas); }
.rp__body { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px 24px; }
.rp__card { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; max-width: 900px; }
.rp__head { display: flex; align-items: center; gap: 8px; }
.rp__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); flex: 1; }
.rp__lead { margin: 0; color: var(--ink-2); }
.rp__banner { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; font: var(--text-small); }
.rp__banner--warn { background: var(--warn-bg); color: var(--warn-ink); }
.rp__banner--danger { background: var(--danger-bg); color: var(--danger-ink); }
.rp__field { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; gap: 6px 16px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--hairline); }
.rp__label { font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.rp__help { font: var(--text-small); color: var(--ink-2); }
.rp__control { display: grid; grid-template-columns: auto minmax(180px, 1fr); align-items: center; gap: 8px 10px; max-width: 520px; }
.rp__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
@media (max-width: 720px) { .rp__field { grid-template-columns: 1fr; } }
</style>
