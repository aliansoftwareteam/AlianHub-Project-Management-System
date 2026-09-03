<template>
    <div class="billing__body billing__body--wide">
        <div class="billing__main ah-scroll">
            <div class="billing__invoice-bar">
                <span class="ah-h3">{{ $t('BillingV2.invoices_title') }}</span>
                <span class="ah-toolbar__spacer"></span>
                <select class="ah-input billing__pick" :value="pickedMilestone" @change="onPickMilestone($event.target.value)">
                    <option value="">{{ $t('BillingV2.new_from_milestone') }}</option>
                    <option v-for="m in invoiceableMilestones" :key="m.id" :value="m.id" :disabled="m.blocked">
                        {{ m.name }}{{ m.blocked ? ` — ${$t('BillingV2.milestone_not_invoiceable')}` : '' }}
                    </option>
                </select>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="draftMonth">
                    {{ $t('BillingV2.new_from_month') }}
                </button>
            </div>

            <p v-if="invoices.loading && !invoices.list.length" class="billing__state">{{ $t('BillingV2.loading') }}</p>
            <div v-else-if="!invoices.list.length" class="ah-empty">{{ $t('BillingV2.no_invoices') }}</div>

            <div v-else class="billing__invoice-list">
                <button
                    v-for="inv in invoices.list"
                    :key="inv._id"
                    type="button"
                    class="ah-card billing__invoice-card"
                    :class="{ 'is-open': openId === inv._id }"
                    @click="open(inv)"
                >
                    <span class="billing__invoice-no ah-mono">{{ inv.number }}</span>
                    <span class="billing__invoice-label">{{ lineSummary(inv) }}</span>
                    <span class="ah-chip" :class="statusChip(inv.status)">{{ $t(`BillingV2.invoice_${inv.status}`) }}</span>
                    <span class="billing__figure">{{ money(inv.totalMinor, inv.currencySymbol) }}</span>
                </button>
            </div>
        </div>

        <transition name="ah-fade">
            <div v-if="sheet" class="billing__overlay" @click.self="close">
                <InvoiceSheet
                    :sheet="sheet"
                    :project-name="projectName"
                    :busy="busy"
                    @close="close"
                    @send="onSend"
                    @paid="onPaid"
                    @add-line="onAddLine"
                />
            </div>
        </transition>
    </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import InvoiceSheet from "./InvoiceSheet.vue";
import { currentMonth, money } from "./useBilling";

defineOptions({ name: "BillingInvoices" });

const props = defineProps({ billing: { type: Object, required: true } });
const { t } = useI18n();
const $toast = useToast();

const invoices = computed(() => props.billing.invoices);
const busy = computed(() => props.billing.saving.value);
const contractData = computed(() => props.billing.contract.data);
const projectName = computed(() => (contractData.value ? contractData.value.project.name : ""));

const pickedMilestone = ref("");
const openId = ref("");
const sheet = ref(null);

const invoiceableMilestones = computed(() => (contractData.value ? contractData.value.milestones : [])
    .filter((m) => !m.cancelled)
    .map((m) => ({ id: m.id, name: m.name, blocked: m.billingState === "paid" || m.billingState === "invoiced" })));

const lineSummary = (inv) => (inv.lines || []).map((l) => l.label).filter(Boolean).join(" + ") || inv.number;

const CHIP = { draft: "ah-chip--warn", sent: "ah-chip--brand", paid: "ah-chip--ok" };
const statusChip = (status) => CHIP[status] || "";

const open = async (inv) => {
    openId.value = inv._id;
    const loaded = await props.billing.loadInvoice(inv._id);
    if (!loaded) {
        $toast.error(t("BillingV2.load_failed"));
        return;
    }
    sheet.value = loaded;
};

const close = () => {
    sheet.value = null;
    openId.value = "";
};

const onPickMilestone = async (id) => {
    pickedMilestone.value = "";
    if (!id) return;
    const result = await props.billing.draftFromMilestone(id);
    if (result.ok) {
        await props.billing.loadContract();
        $toast.success(result.message);
    } else {
        $toast.error(result.message);
    }
};

const draftMonth = async () => {
    const result = await props.billing.draftFromMonth(currentMonth());
    if (result.ok) $toast.success(result.message);
    else $toast.error(result.message);
};

const refreshSheet = async (id) => {
    const loaded = await props.billing.loadInvoice(id);
    if (loaded) sheet.value = loaded;
};

const onSend = async (id) => {
    const result = await props.billing.sendInvoice(id);
    if (result.ok) { await refreshSheet(id); await props.billing.loadContract(); $toast.success(result.message); }
    else $toast.error(result.message);
};

const onAddLine = async ({ id, lines }) => {
    const result = await props.billing.updateInvoice(id, { lines });
    if (result.ok) await refreshSheet(id);
    else $toast.error(result.message);
};

const onPaid = async (id) => {
    const result = await props.billing.markPaid(id);
    if (result.ok) { await refreshSheet(id); await props.billing.loadContract(); $toast.success(result.message); }
    else $toast.error(result.message);
};
</script>
