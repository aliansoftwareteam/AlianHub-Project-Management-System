<template>
    <article class="billing__sheet" role="dialog" aria-modal="true" :aria-label="invoice.number">
        <header class="billing__sheet-head">
            <div>
                <div class="billing__sheet-title">
                    {{ invoice.number }}
                    <span class="ah-chip ah-chip--mono" :class="statusChip">{{ $t(`Billing.invoice_${invoice.status}`) }}</span>
                </div>
                <div class="ah-small">{{ metaLine }}</div>
            </div>
            <span class="ah-toolbar__spacer"></span>
            <span v-if="periodLine" class="ah-mono billing__sheet-period">{{ periodLine }}</span>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Billing.cancel')" @click="$emit('close')">
                <ShellIcon name="x" :size="15" />
            </button>
        </header>

        <div class="billing__sheet-body ah-scroll">
            <div class="billing__line billing__line--head">
                <span>{{ $t('Billing.col_line') }}</span>
                <span class="billing__num">{{ $t('Billing.col_qty') }}</span>
                <span class="billing__num">{{ $t('Billing.col_rate') }}</span>
                <span class="billing__num">{{ $t('Billing.col_amount') }}</span>
            </div>

            <template v-for="line in invoice.lines" :key="line.id">
                <div class="billing__line">
                    <div>
                        <div class="billing__line-label">{{ line.label }}</div>
                        <button type="button" class="billing__line-detail" @click="toggle(line.id)">
                            {{ line.detail || $t('Billing.line_expand') }}
                            <ShellIcon :name="expanded === line.id ? 'chevronDown' : 'chevronRight'" :size="12" />
                        </button>
                    </div>
                    <span class="billing__num ah-mono">{{ qty(line) }}</span>
                    <span class="billing__num ah-mono">{{ line.unitMinor === null ? '—' : money(line.unitMinor, symbol) }}</span>
                    <span class="billing__num billing__figure">{{ money(line.amountMinor, symbol) }}</span>
                </div>
                <div v-if="expanded === line.id" class="billing__trace">
                    <div v-if="!tasksFor(line).length && !logsFor(line).length" class="ah-small">{{ $t('Billing.line_nothing') }}</div>
                    <div v-if="tasksFor(line).length" class="billing__trace-group">
                        <div class="ah-label">{{ $t('Billing.line_tasks', { count: tasksFor(line).length }) }}</div>
                        <div v-for="task in tasksFor(line)" :key="task._id" class="billing__trace-row">
                            <span class="ah-mono billing__trace-key">{{ task.key }}</span>
                            <span class="billing__trace-name">{{ task.name }}</span>
                            <span class="ah-chip" :class="task.done ? 'ah-chip--ok' : ''">{{ task.done ? $t('Billing.task_done') : $t('Billing.task_open') }}</span>
                        </div>
                    </div>
                    <div v-if="logsFor(line).length" class="billing__trace-group">
                        <div class="ah-label">{{ $t('Billing.line_timelogs', { count: logsFor(line).length }) }}</div>
                        <div v-for="log in logsFor(line)" :key="log._id" class="billing__trace-row">
                            <span class="ah-mono billing__trace-key">{{ dayLabel(log.at * 1000) }}</span>
                            <span class="billing__trace-name">{{ log.userName }} · {{ log.note }}</span>
                            <span class="ah-mono">{{ (log.minutes / 60).toFixed(1) }}h</span>
                        </div>
                    </div>
                </div>
            </template>

            <form v-if="invoice.status === 'draft' && adding" class="billing__line-add" @submit.prevent="addLine">
                <div class="ah-field">
                    <label class="ah-field__label" for="line-kind">{{ $t('Billing.line_kind') }}</label>
                    <select id="line-kind" v-model="draft.kind" class="ah-input">
                        <option value="change_request">{{ $t('Billing.kind_change_request') }}</option>
                        <option value="expense">{{ $t('Billing.kind_expense') }}</option>
                        <option value="adjustment">{{ $t('Billing.kind_adjustment') }}</option>
                    </select>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="line-label">{{ $t('Billing.line_label') }}</label>
                    <input id="line-label" v-model="draft.label" class="ah-input" :class="{ 'ah-input--error': lineError }" maxlength="200" />
                    <span v-if="lineError" class="ah-field__error">{{ lineError }}</span>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="line-qty">{{ draft.unit === '' ? $t('Billing.line_amount') : $t('Billing.col_qty') }}</label>
                    <input id="line-qty" v-model="draft.qty" class="ah-input" type="number" min="0" step="0.01" />
                    <span class="ah-field__hint">{{ $t('Billing.line_unit_hint') }}</span>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="line-rate">{{ $t('Billing.line_unit') }}</label>
                    <input id="line-rate" v-model="draft.unit" class="ah-input" type="number" min="0" step="0.01" />
                </div>
                <div class="billing__line-add-actions">
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy">{{ $t('Billing.save') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="adding = false">{{ $t('Billing.cancel') }}</button>
                </div>
            </form>
            <button
                v-else-if="invoice.status === 'draft'"
                type="button"
                class="billing__line-add-open"
                @click="openAdd"
            >
                <span class="billing__add-plus">+</span>{{ $t('Billing.add_line') }}
            </button>

            <div class="billing__totals">
                <div class="billing__total-row">
                    <span class="ah-muted">{{ $t('Billing.subtotal') }}</span>
                    <span class="ah-mono billing__total-value">{{ money(invoice.subtotalMinor, symbol) }}</span>
                </div>
                <div v-if="invoice.taxRateBp" class="billing__total-row">
                    <span class="ah-muted">{{ taxLine }}</span>
                    <span class="ah-mono billing__total-value">{{ money(invoice.taxMinor, symbol) }}</span>
                </div>
                <div class="billing__total-row billing__total-row--due">
                    <span class="billing__due-label">{{ $t('Billing.total_due') }}</span>
                    <span class="billing__due-value">{{ money(invoice.totalMinor, symbol) }}</span>
                </div>
            </div>
        </div>

        <footer class="billing__sheet-foot">
            <button
                v-if="invoice.status === 'draft'"
                type="button"
                class="ah-btn ah-btn--primary ah-btn--sm"
                :disabled="busy"
                @click="$emit('send', invoice._id)"
            >
                {{ $t('Billing.send_to_client') }}
            </button>
            <button
                v-else-if="invoice.status === 'sent'"
                type="button"
                class="ah-btn ah-btn--primary ah-btn--sm"
                :disabled="busy"
                @click="$emit('paid', invoice._id)"
            >
                {{ $t('Billing.mark_paid') }}
            </button>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="pdfBusy" @click="downloadPdf">
                {{ $t('Billing.pdf') }}
            </button>
            <button
                type="button"
                class="ah-btn ah-btn--secondary ah-btn--sm"
                disabled
                :title="$t('Billing.stripe_disabled')"
            >
                {{ $t('Billing.export_stripe') }}
            </button>
            <span class="ah-toolbar__spacer"></span>
            <span class="ah-small">{{ $t('Billing.every_line_links') }}</span>
        </footer>
    </article>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { dayLabel, money, percentFromBp } from "./useBilling";

defineOptions({ name: "InvoiceSheet" });

const props = defineProps({
    sheet: { type: Object, required: true },
    projectName: { type: String, default: "" },
    busy: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "send", "paid", "add-line"]);

const { t } = useI18n();
const $toast = useToast();

const invoice = computed(() => props.sheet.invoice);
const symbol = computed(() => invoice.value.currencySymbol || "$");
const expanded = ref("");
const pdfBusy = ref(false);
const adding = ref(false);
const lineError = ref("");
const draft = reactive({ kind: "change_request", label: "", qty: "1", unit: "" });

const openAdd = () => {
    adding.value = true;
    lineError.value = "";
    draft.kind = "change_request";
    draft.label = "";
    draft.qty = "1";
    draft.unit = "";
};

/* A hand-added line still goes through the server's own pricing — the sheet
 * sends the line, never a total. */
const addLine = () => {
    if (!draft.label.trim()) {
        lineError.value = t("Billing.line_label_required");
        return;
    }
    lineError.value = "";
    const unit = draft.unit === "" ? null : Number(draft.unit);
    const entered = Number(draft.qty) || 0;
    const line = unit === null || !Number.isFinite(unit)
        // No unit price: the number typed IS the amount.
        ? { kind: draft.kind, label: draft.label.trim(), unitMinor: null, amountMinor: Math.round(entered * 100) }
        : { kind: draft.kind, label: draft.label.trim(), qtyMilli: Math.round(entered * 1000), unitMinor: Math.round(unit * 100) };
    adding.value = false;
    emit("add-line", { id: invoice.value._id, lines: [...(invoice.value.lines || []), line] });
};

const CHIP = { draft: "ah-chip--warn", sent: "ah-chip--brand", paid: "ah-chip--ok" };
const statusChip = computed(() => CHIP[invoice.value.status] || "");

const metaLine = computed(() => t("Billing.invoice_meta", {
    client: invoice.value.clientName || t("Billing.no_client"),
    project: props.projectName,
    days: daysBetween(invoice.value.issuedDate, invoice.value.dueDate),
}));

const periodLine = computed(() => {
    if (!invoice.value.issuedDate) return "";
    return t("Billing.period", {
        from: (dayLabel(invoice.value.issuedDate) || "").toUpperCase(),
        to: (dayLabel(invoice.value.dueDate) || "").toUpperCase(),
    });
});

const taxLine = computed(() => t("Billing.tax_named", {
    label: invoice.value.taxLabel || t("Billing.tax"),
    percent: percentFromBp(invoice.value.taxRateBp),
}));

function daysBetween(from, to) {
    if (!from || !to) return 30;
    return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000));
}

const qty = (line) => (line.unitMinor === null ? "1" : (line.qtyMilli / 1000).toFixed(2).replace(/\.00$/, ""));

const toggle = (id) => { expanded.value = expanded.value === id ? "" : id; };

const taskById = computed(() => new Map((props.sheet.trace.tasks || []).map((task) => [task._id, task])));
const logById = computed(() => new Map((props.sheet.trace.timelogs || []).map((log) => [log._id, log])));

const tasksFor = (line) => (line.taskIds || []).map((id) => taskById.value.get(String(id))).filter(Boolean);
const logsFor = (line) => (line.timelogIds || []).map((id) => logById.value.get(String(id))).filter(Boolean);

/* The PDF comes from the existing Export endpoint, which renders exactly the
 * rows it is given — so the PDF and the sheet can never disagree. */
const downloadPdf = async () => {
    pdfBusy.value = true;
    try {
        const inv = invoice.value;
        const params = {
            title: inv.number,
            subtitle: metaLine.value,
            filename: inv.number,
            meta: [periodLine.value].filter(Boolean),
            tableHead: [t("Billing.col_line"), t("Billing.col_qty"), t("Billing.col_rate"), t("Billing.col_amount")],
            tableRows: (inv.lines || []).map((line) => [
                line.detail ? `${line.label} (${line.detail})` : line.label,
                qty(line),
                line.unitMinor === null ? "—" : money(line.unitMinor, symbol.value),
                money(line.amountMinor, symbol.value),
            ]),
            totalRow: ["", "", t("Billing.total_due"), money(inv.totalMinor, symbol.value)],
        };
        const res = await apiRequest("post", env.EXPORT_PDF, { type: "invoice", params }, undefined, { responseType: "blob" });
        const url = window.URL.createObjectURL(res.data);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${inv.number}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
    } catch (error) {
        $toast.error(t("Billing.save_failed"));
    } finally {
        pdfBusy.value = false;
    }
};
</script>
