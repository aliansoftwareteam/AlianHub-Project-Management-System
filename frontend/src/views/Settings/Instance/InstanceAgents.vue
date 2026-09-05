<template>
    <section v-if="privileged" class="ah-card in-card" data-test="instance-agents">
        <div class="in-card__head"><span class="in-card__title">{{ $t('Instance.agents_title') }}</span></div>
        <p class="ah-small in-agents__lead">{{ $t('Instance.agents_lead') }}</p>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!loaded" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div class="in-field">
                <div>
                    <label class="in-field__label" for="ag-undo">{{ $t('Instance.agent_undo_hours') }}</label>
                    <div class="in-field__help">{{ $t('Instance.agent_undo_help') }}</div>
                </div>
                <div class="in-field__control">
                    <input id="ag-undo" v-model.number="draft.undoHours" type="number" min="1" max="720" step="1" class="ah-input" />
                </div>
            </div>

            <div class="in-field">
                <div>
                    <label class="in-field__label" for="ag-budget">{{ $t('Instance.agent_budget') }}</label>
                    <div class="in-field__help">{{ $t('Instance.agent_budget_help') }}</div>
                </div>
                <div class="in-field__control">
                    <input id="ag-budget" v-model.number="draft.monthlyBudgetUsd" type="number" min="0" step="1" class="ah-input" />
                </div>
            </div>

            <div class="in-field">
                <div>
                    <span class="in-field__label">{{ $t('Instance.agent_usage') }}</span>
                    <div class="in-field__help ah-mono">{{ view.month }}</div>
                </div>
                <div class="in-field__control">
                    <div class="in-meter" :class="`is-${view.level}`" role="progressbar" :aria-valuenow="view.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="$t('Instance.agent_usage')" data-test="usage-bar">
                        <span class="in-meter__fill" :style="{ width: `${view.width}%` }"></span>
                    </div>
                    <span class="ah-small ah-mono" data-test="usage-line">{{ usageLine }}</span>
                    <div class="in-alerts">
                        <span
                            v-for="a in view.alerts"
                            :key="a.threshold"
                            class="ah-chip"
                            :class="alertChip(a)"
                            :data-test="`alert-${a.threshold}`"
                            :data-state="a.at ? 'sent' : 'quiet'"
                        >{{ a.at ? $t('Instance.agent_alert_sent', { threshold: a.threshold, at: when(a.at) }) : $t('Instance.agent_alert_quiet', { threshold: a.threshold }) }}</span>
                    </div>
                </div>
            </div>

            <div class="in-field">
                <div><span class="in-field__label">{{ $t('Instance.agent_provider') }}</span></div>
                <div class="in-field__control in-provider" data-test="provider">
                    <span v-if="!provider.name" class="ah-small">{{ $t('Instance.agent_provider_none') }}</span>
                    <template v-else>
                        <span class="ah-mono">{{ provider.name }}</span>
                        <span class="ah-small">{{ provider.region ? $t('Instance.agent_region', { region: provider.region }) : $t('Instance.agent_region_any') }}</span>
                    </template>
                    <span class="ah-chip" :class="provider.hasKey ? 'ah-chip--ok' : 'ah-chip--warn'" data-test="key-state">{{ provider.hasKey ? $t('Instance.agent_key_set') : $t('Instance.agent_key_missing') }}</span>
                </div>
            </div>

            <div class="in-actions">
                <div class="ah-toolbar__spacer"></div>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !dirty" data-test="save" @click="save">{{ busy ? $t('Instance.saving') : $t('Instance.save') }}</button>
            </div>
        </template>
    </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { reasonOf } from "@/views/Ai/useAgents";
import { budgetView } from "./agentBudget";

defineOptions({ name: "InstanceAgents" });

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();

const loaded = ref(false);
const busy = ref(false);
const error = ref("");
const budget = ref(null);
const provider = ref({ name: "", hasKey: false, region: "" });
const draft = reactive({ undoHours: 24, monthlyBudgetUsd: 0 });
let baseline = { ...draft };

const privileged = computed(() => [1, 2].includes(Number(getters["settings/companyUserDetail"]?.roleType)));
const view = computed(() => budgetView(budget.value));
const dirty = computed(() => draft.undoHours !== baseline.undoHours || draft.monthlyBudgetUsd !== baseline.monthlyBudgetUsd);
const usageLine = computed(() => (view.value.cap > 0
    ? t("Instance.agent_usage_line", { used: view.value.used.toFixed(2), cap: view.value.cap.toFixed(0), percent: view.value.percent })
    : t("Instance.agent_usage_uncapped", { used: view.value.used.toFixed(2) })));

const when = (at) => (at ? new Date(at).toLocaleString() : "");
const alertChip = (a) => (!a.at ? "ah-chip--mono" : a.threshold >= 100 ? "ah-chip--danger" : "ah-chip--warn");

const unwrap = (res) => {
    if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t("Instance.agent_load_failed"));
    return res.data.data || {};
};

function seed(settings) {
    draft.undoHours = Number(settings.undoHours ?? 24);
    draft.monthlyBudgetUsd = Number(settings.monthlyBudgetUsd ?? 0);
    provider.value = { name: settings.provider?.name || "", hasKey: settings.provider?.hasKey === true, region: settings.provider?.region || "" };
    baseline = { undoHours: draft.undoHours, monthlyBudgetUsd: draft.monthlyBudgetUsd };
}

async function load() {
    if (!privileged.value) return;
    error.value = "";
    try {
        const [settingsRes, budgetRes] = await Promise.all([apiRequest("get", env.AGENT_SETTINGS), apiRequest("get", env.AGENT_BUDGET)]);
        seed(unwrap(settingsRes));
        budget.value = unwrap(budgetRes);
        loaded.value = true;
    } catch (e) {
        error.value = reasonOf(e, "Instance.agent_load_failed");
    }
}

async function save() {
    busy.value = true;
    try {
        const res = await apiRequest("put", env.AGENT_SETTINGS, { undoHours: draft.undoHours, monthlyBudgetUsd: draft.monthlyBudgetUsd });
        seed(unwrap(res));
        const budgetRes = await apiRequest("get", env.AGENT_BUDGET).catch(() => null);
        if (budgetRes?.data?.status === true) budget.value = budgetRes.data.data || budget.value;
        $toast.success(t("Instance.agent_saved"));
    } catch (e) {
        $toast.error(reasonOf(e, "Instance.agent_save_failed"));
    } finally {
        busy.value = false;
    }
}

onMounted(load);
</script>

<style scoped>
.in-agents__lead { margin: 0; color: var(--ink-2); }
.in-meter { position: relative; height: 8px; border-radius: 999px; background: var(--hairline); overflow: hidden; max-width: 520px; }
.in-meter__fill { display: block; height: 100%; border-radius: inherit; background: var(--ok-ink, #1a7f4b); transition: width 200ms ease; }
.in-meter.is-warn .in-meter__fill { background: var(--warn-ink, #b54708); }
.in-meter.is-over .in-meter__fill { background: var(--danger-ink, #b42318); }
.in-alerts { display: flex; flex-wrap: wrap; gap: 6px; }
.in-provider { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 8px; }
</style>
