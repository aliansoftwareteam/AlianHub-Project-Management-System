<template>
    <div class="ah-page billing">
        <header class="ah-toolbar billing__bar">
            <h1 class="billing__title">{{ $t('BillingV2.title') }} · {{ projectName }}</h1>
            <span v-if="clientLine" class="billing__client ah-mono">{{ clientLine }}</span>
            <nav class="billing__tabs" aria-label="Billing views">
                <button type="button" class="billing__tab" :class="{ 'is-active': tab === 'contract' }" @click="setTab('contract')">
                    {{ $t('BillingV2.tab_contract') }}
                </button>
                <button type="button" class="billing__tab" :class="{ 'is-active': tab === 'invoices' }" @click="setTab('invoices')">
                    {{ $t('BillingV2.tab_invoices') }}
                    <span v-if="invoiceCount" class="billing__count ah-mono">{{ invoiceCount }}</span>
                </button>
                <button type="button" class="billing__tab" :class="{ 'is-active': tab === 'client' }" @click="setTab('client')">
                    {{ $t('BillingV2.tab_client_view') }}
                </button>
            </nav>
            <span class="ah-toolbar__spacer"></span>
            <button v-if="tab === 'contract'" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="settingsOpen = !settingsOpen">
                <ShellIcon name="settings" :size="14" />
                {{ $t('BillingV2.settings') }}
            </button>
        </header>

        <p v-if="contract.loading && !contract.data" class="billing__state">{{ $t('BillingV2.loading') }}</p>
        <div v-else-if="contract.error" class="ah-empty billing__state">{{ $t('BillingV2.load_failed') }}</div>

        <template v-else-if="contract.data">
            <BillingSettings
                v-if="settingsOpen"
                :contract="contract.data.contract"
                :saving="saving"
                @save="onSaveContract"
                @close="settingsOpen = false"
            />

            <BillingContract
                v-if="tab === 'contract'"
                :billing="billing"
                @mode="onMode"
                @invoice-milestone="onInvoiceMilestone"
            />
            <BillingInvoices
                v-else-if="tab === 'invoices'"
                :billing="billing"
            />
            <BillingClientView
                v-else
                :billing="billing"
            />
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import BillingContract from "./BillingContract.vue";
import BillingInvoices from "./BillingInvoices.vue";
import BillingClientView from "./BillingClientView.vue";
import BillingSettings from "./BillingSettings.vue";
import { useBilling } from "./useBilling";
import "./style.css";

defineOptions({ name: "ProjectBilling" });

const route = useRoute();
const { t } = useI18n();
const $toast = useToast();

const projectId = String(route.params.id || "");
const billing = useBilling(projectId);
const { contract, invoices, saving } = billing;

const tab = ref("contract");
const settingsOpen = ref(false);

const projectName = computed(() => (contract.data && contract.data.project.name) || "");
const clientLine = computed(() => {
    if (!contract.data) return "";
    const c = contract.data.contract;
    if (!c.clientName) return "";
    return `${(c.vendorName || "").toUpperCase()} → ${c.clientName.toUpperCase()}`.replace(/^ → /, "");
});
const invoiceCount = computed(() => (contract.data ? contract.data.invoiceCount : 0));

const setTab = (next) => {
    tab.value = next;
    if (next === "invoices" && !invoices.list.length) billing.loadInvoices();
    if (next === "client") billing.loadClientView();
};

const onMode = async (mode) => {
    const result = await billing.saveContract({ billingMode: mode });
    if (!result.ok) $toast.error(result.message || t("BillingV2.save_failed"));
    else if (mode === "hourly") billing.loadHourly();
};

const onSaveContract = async (patch) => {
    const result = await billing.saveContract(patch);
    if (result.ok) {
        settingsOpen.value = false;
        $toast.success(t("BillingV2.saved"));
    } else {
        $toast.error(result.message || t("BillingV2.save_failed"));
    }
};

const onInvoiceMilestone = async (milestoneId) => {
    const result = await billing.draftFromMilestone(milestoneId);
    if (!result.ok) {
        $toast.error(result.message || t("BillingV2.save_failed"));
        return;
    }
    await billing.loadContract();
    setTab("invoices");
};

watch(
    () => contract.data && contract.data.contract.billingMode,
    (mode) => { if (mode === "hourly" && !billing.hourly.data) billing.loadHourly(); },
);

onMounted(async () => {
    await billing.loadContract();
    billing.loadInvoices();
});
</script>
