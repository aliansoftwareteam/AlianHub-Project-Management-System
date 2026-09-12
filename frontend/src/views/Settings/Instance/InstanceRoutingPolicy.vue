<template>
    <section v-if="privileged" class="ah-card in-card" data-test="instance-routing-policy">
        <div class="in-card__head"><span class="in-card__title">{{ $t('Instance.routing_title') }}</span></div>
        <p class="ah-small in-routing__lead">{{ $t('Instance.routing_lead') }}</p>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!loaded" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div v-if="!routerEnabled" class="in-banner in-banner--warn" data-test="router-off">
                <ShellIcon name="alert" :size="15" /><span>{{ $t('Instance.routing_flag_off') }}</span>
            </div>
            <div v-if="!models.length" class="in-banner in-banner--warn" data-test="models-empty">
                <ShellIcon name="alert" :size="15" /><span>{{ $t('Instance.routing_no_models') }}</span>
            </div>

            <div v-for="row in rows" :key="row.taskClass" class="in-field" :data-test="`class-${row.taskClass}`">
                <div>
                    <span class="in-field__label">{{ $t(`Instance.routing_class_${row.taskClass}`) }}</span>
                    <div class="in-field__help">{{ $t(`Instance.routing_class_${row.taskClass}_help`) }}</div>
                    <div class="in-field__help ah-mono">{{ $t('Instance.routing_input_budget', { tokens: row.inputBudgetTokens }) }}</div>
                </div>
                <div class="in-field__control in-routing__control">
                    <label class="ah-small" :for="`rp-model-${row.taskClass}`">{{ $t('Instance.routing_model') }}</label>
                    <select :id="`rp-model-${row.taskClass}`" v-model="row.model" class="ah-input" :data-test="`model-${row.taskClass}`">
                        <option value="">{{ $t('Instance.routing_model_inherit') }}</option>
                        <option v-for="m in models" :key="m.model" :value="m.model">{{ m.model }} · {{ m.provider }}</option>
                    </select>

                    <label class="ah-small" :for="`rp-quality-${row.taskClass}`">{{ $t('Instance.routing_quality_floor') }}</label>
                    <select :id="`rp-quality-${row.taskClass}`" v-model="row.qualityFloor" class="ah-input" :data-test="`quality-${row.taskClass}`">
                        <option v-for="q in QUALITY" :key="q" :value="q">{{ $t(`Instance.routing_quality_${q}`) }}</option>
                    </select>

                    <label class="ah-small" :for="`rp-latency-${row.taskClass}`">{{ $t('Instance.routing_latency_target') }}</label>
                    <input :id="`rp-latency-${row.taskClass}`" v-model.number="row.latencyTargetMs" type="number" min="250" max="600000" step="250" class="ah-input" :data-test="`latency-${row.taskClass}`" />
                </div>
            </div>

            <div class="in-actions">
                <div class="ah-toolbar__spacer"></div>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !dirty" data-test="save-routing" @click="save">{{ busy ? $t('Instance.saving') : $t('Instance.save') }}</button>
            </div>
        </template>
    </section>
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

defineOptions({ name: "InstanceRoutingPolicy" });

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
    if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t("Instance.routing_load_failed"));
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
        error.value = reasonOf(e, "Instance.routing_load_failed");
    }
}

async function save() {
    busy.value = true;
    try {
        const classes = Object.fromEntries(rows.value.map((r) => [r.taskClass, { model: r.model || "", qualityFloor: r.qualityFloor, latencyTargetMs: r.latencyTargetMs }]));
        seed(unwrap(await apiRequest("put", env.AGENT_ROUTING_POLICY, { classes })));
        $toast.success(t("Instance.routing_saved"));
    } catch (e) {
        $toast.error(reasonOf(e, "Instance.routing_save_failed"));
    } finally {
        busy.value = false;
    }
}

onMounted(load);
</script>

<style scoped>
.in-routing__lead { margin: 0; color: var(--ink-2); }
.in-routing__control { display: grid; grid-template-columns: auto minmax(180px, 1fr); align-items: center; gap: 8px 10px; max-width: 520px; }
</style>
