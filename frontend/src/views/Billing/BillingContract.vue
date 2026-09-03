<template>
    <div class="billing__body">
        <div class="billing__main ah-scroll">
            <div class="billing__modes">
                <button
                    type="button"
                    class="billing__mode"
                    :class="{ 'is-active': mode === 'fixed' }"
                    :aria-pressed="mode === 'fixed'"
                    @click="$emit('mode', 'fixed')"
                >
                    <span class="billing__radio" :class="{ 'is-on': mode === 'fixed' }"></span>
                    <span class="billing__mode-name">{{ $t('BillingV2.mode_fixed') }}</span>
                    <span class="billing__mode-help">{{ $t('BillingV2.mode_fixed_help') }}</span>
                </button>
                <button
                    type="button"
                    class="billing__mode"
                    :class="{ 'is-active': mode === 'hourly' }"
                    :aria-pressed="mode === 'hourly'"
                    @click="$emit('mode', 'hourly')"
                >
                    <span class="billing__radio" :class="{ 'is-on': mode === 'hourly' }"></span>
                    <span class="billing__mode-name">{{ $t('BillingV2.mode_hourly') }}</span>
                    <span class="billing__mode-help">{{ $t('BillingV2.mode_hourly_help') }}</span>
                </button>
            </div>

            <BillingHourly v-if="mode === 'hourly'" :billing="billing" />

            <template v-else>
                <div class="ah-card billing__table">
                    <div class="billing__row billing__row--head">
                        <span>{{ $t('BillingV2.col_milestone') }}</span>
                        <span>{{ $t('BillingV2.col_due') }}</span>
                        <span>{{ $t('BillingV2.col_amount') }}</span>
                        <span>{{ $t('BillingV2.col_signoff') }}</span>
                        <span>{{ $t('BillingV2.col_state') }}</span>
                    </div>
                    <div v-if="!milestones.length" class="ah-empty billing__empty">{{ $t('BillingV2.no_milestones') }}</div>
                    <div
                        v-for="m in milestones"
                        :key="m.id"
                        class="billing__row billing__row--data"
                        :class="{ 'is-live': m.billingState === 'in_progress' || m.billingState === 'ready', 'is-muted': m.billingState === 'not_due' }"
                    >
                        <div class="billing__cell-name">
                            <div class="billing__ms-name">{{ m.name }}</div>
                            <div class="billing__ms-meta" :title="m.scope === 'explicit' ? $t('BillingV2.scope_explicit') : $t('BillingV2.scope_window')">
                                {{ metaFor(m) }}
                            </div>
                            <div v-if="m.percentBp !== null && m.percentBp > 0 && m.percentBp < 10000" class="billing__bar">
                                <span :style="{ width: `${percentFromBp(m.percentBp)}%` }"></span>
                            </div>
                        </div>
                        <span class="ah-mono billing__cell-due">{{ dayLabel(m.dueDate) || '—' }}</span>
                        <span class="billing__cell-amount">{{ money(m.amountMinor, symbol) }}</span>
                        <span class="billing__cell-signoff">{{ signOffName(m) }}</span>
                        <div class="billing__cell-state">
                            <span class="ah-chip" :class="stateChip(m.billingState)">{{ $t(`BillingV2.state_${m.billingState}`) }}</span>
                            <button
                                v-if="m.billingState === 'ready'"
                                type="button"
                                class="ah-btn ah-btn--outline ah-btn--sm billing__invoice-btn"
                                :disabled="busy"
                                @click="$emit('invoice-milestone', m.id)"
                            >
                                {{ $t('BillingV2.tab_invoices') }}
                            </button>
                        </div>
                    </div>
                </div>

                <form v-if="adding" class="ah-card billing__add" @submit.prevent="submitMilestone">
                    <div class="ah-field">
                        <label class="ah-field__label" for="ms-name">{{ $t('BillingV2.milestone_name') }}</label>
                        <input id="ms-name" v-model="draft.milestoneName" class="ah-input" :class="{ 'ah-input--error': errors.milestoneName }" maxlength="160" />
                        <span v-if="errors.milestoneName" class="ah-field__error">{{ errors.milestoneName }}</span>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label" for="ms-amount">{{ $t('BillingV2.milestone_amount') }}</label>
                        <input id="ms-amount" v-model="draft.amount" class="ah-input" :class="{ 'ah-input--error': errors.amount }" type="number" min="0" step="0.01" />
                        <span v-if="errors.amount" class="ah-field__error">{{ errors.amount }}</span>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label" for="ms-due">{{ $t('BillingV2.milestone_due') }}</label>
                        <input id="ms-due" v-model="draft.dueDate" class="ah-input" type="date" />
                    </div>
                    <div class="billing__add-actions">
                        <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy">{{ $t('BillingV2.save') }}</button>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="adding = false">{{ $t('BillingV2.cancel') }}</button>
                    </div>
                </form>
                <button v-else type="button" class="billing__add-open" @click="openAdd">
                    <span class="billing__add-plus">+</span>{{ $t('BillingV2.add_milestone') }}
                </button>

                <div class="ah-card billing__rules">
                    <div class="ah-h3">{{ $t('BillingV2.rules') }}</div>
                    <label class="billing__rule">
                        <input type="checkbox" class="ah-check" :checked="contract.requireTasksDoneToInvoice" @change="toggleRule('requireTasksDoneToInvoice', $event)" />
                        <span>{{ $t('BillingV2.rule_tasks_done') }}</span>
                    </label>
                    <label class="billing__rule">
                        <input type="checkbox" class="ah-check" :checked="contract.signOffIsTask" @change="toggleRule('signOffIsTask', $event)" />
                        <span>{{ $t('BillingV2.rule_signoff_task') }}</span>
                    </label>
                    <label class="billing__rule">
                        <input type="checkbox" class="ah-check" :checked="contract.warnWhenHoursExceedValue" @change="toggleRule('warnWhenHoursExceedValue', $event)" />
                        <span>{{ $t('BillingV2.rule_warn_hours') }}</span>
                    </label>
                </div>
            </template>
        </div>

        <aside class="billing__panel ah-scroll">
            <div class="ah-label">{{ $t('BillingV2.contract_total') }}</div>
            <div>
                <div class="billing__total">{{ money(rollup.totalMinor, symbol) }}</div>
                <div class="ah-small">{{ spanLabel }}</div>
            </div>

            <div class="billing__money">
                <div class="billing__money-row">
                    <span class="ah-muted">{{ $t('BillingV2.paid') }}</span>
                    <span class="billing__figure billing__figure--ok">{{ money(rollup.paidMinor, symbol) }}</span>
                </div>
                <div class="billing__money-row">
                    <span class="ah-muted">{{ $t('BillingV2.invoiced_unpaid') }}</span>
                    <span class="billing__figure billing__figure--warn">{{ money(rollup.invoicedUnpaidMinor, symbol) }}</span>
                </div>
                <div class="billing__money-row">
                    <span class="ah-muted">{{ $t('BillingV2.remaining') }}</span>
                    <span class="billing__figure">{{ money(rollup.remainingMinor, symbol) }}</span>
                </div>
                <div class="billing__split">
                    <span class="billing__split-paid" :style="{ width: `${percentFromBp(rollup.paidBp) || 0}%` }"></span>
                    <span class="billing__split-invoiced" :style="{ width: `${percentFromBp(rollup.invoicedUnpaidBp) || 0}%` }"></span>
                </div>
            </div>

            <div class="billing__profit">
                <div class="ah-label">{{ $t('BillingV2.profitability') }}</div>
                <div class="billing__money-row">
                    <span class="ah-muted">{{ $t('BillingV2.hours_logged_label') }}</span>
                    <span class="billing__figure">{{ Math.round(profit.hours) }}h</span>
                </div>
                <template v-if="profit.hasCostRate">
                    <div class="billing__money-row">
                        <span class="ah-muted">{{ $t('BillingV2.cost_at_blended', { rate: money(contract.blendedCostRateMinor, symbol) }) }}</span>
                        <span class="billing__figure">{{ money(profit.costMinor, symbol) }}</span>
                    </div>
                    <div class="billing__money-row">
                        <span class="ah-muted">{{ $t('BillingV2.billed_to_date') }}</span>
                        <span class="billing__figure">{{ money(profit.billedMinor, symbol) }}</span>
                    </div>
                    <div class="billing__money-row billing__money-row--total">
                        <span class="billing__margin-label">{{ $t('BillingV2.margin') }}</span>
                        <span class="billing__figure billing__figure--lg" :class="marginTone">{{ percentFromBp(profit.marginBp) }}%</span>
                    </div>
                </template>
                <div v-else class="billing__rate-empty">
                    <p class="ah-small">{{ $t('BillingV2.no_cost_rate') }}</p>
                    <form v-if="rateEditing" class="ah-field" @submit.prevent="submitRate">
                        <label class="ah-field__label" for="cost-rate">{{ $t('BillingV2.cost_rate_label') }}</label>
                        <input id="cost-rate" v-model="rateDraft" class="ah-input" type="number" min="0" step="0.01" />
                        <span class="ah-field__hint">{{ $t('BillingV2.cost_rate_hint') }}</span>
                        <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy">{{ $t('BillingV2.save') }}</button>
                    </form>
                    <button v-else type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="rateEditing = true">{{ $t('BillingV2.set_cost_rate') }}</button>
                </div>
            </div>

            <div v-if="watchRow" class="billing__watch">
                <strong>{{ $t('BillingV2.watch') }}</strong>
                {{ $t('BillingV2.watch_body', {
                    name: watchRow.name,
                    done: percentFromBp(watchRow.percentBp),
                    burn: percentFromBp(watchRow.burnBp),
                    margin: percentFromBp(watchRow.projectedMarginBp),
                }) }}
            </div>
        </aside>
    </div>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import BillingHourly from "./BillingHourly.vue";
import { dayLabel, hoursFromMinutes, money, percentFromBp } from "./useBilling";

defineOptions({ name: "BillingContract" });

const props = defineProps({ billing: { type: Object, required: true } });
defineEmits(["mode", "invoice-milestone"]);

const { t } = useI18n();

const data = computed(() => props.billing.contract.data);
const contract = computed(() => data.value.contract);
const mode = computed(() => contract.value.billingMode);
const busy = computed(() => props.billing.saving.value);
const symbol = computed(() => contract.value.currencySymbol || "$");
const milestones = computed(() => data.value.milestones || []);
const rollup = computed(() => data.value.rollup);
const profit = computed(() => data.value.profitability);
const watchRow = computed(() => (contract.value.warnWhenHoursExceedValue ? (data.value.watch || [])[0] : null));

const marginTone = computed(() => {
    const bp = profit.value.marginBp;
    if (bp === null) return "";
    if (bp < 1000) return "billing__figure--danger";
    if (bp < 2500) return "billing__figure--warn";
    return "billing__figure--ok";
});

const spanLabel = computed(() => {
    const stamps = milestones.value.map((m) => m.dueDate).filter(Boolean).map((d) => new Date(d).getTime()).filter((n) => !Number.isNaN(n));
    if (!stamps.length) return t("BillingV2.contract_span_undated", { count: milestones.value.length });
    return t("BillingV2.contract_span", {
        count: milestones.value.length,
        from: dayLabel(data.value.project.startDate) || dayLabel(Math.min(...stamps)),
        to: dayLabel(Math.max(...stamps)),
    });
});

const metaFor = (m) => {
    const parts = [t("BillingV2.tasks_count", { count: m.taskCount })];
    if (m.percentBp !== null && m.percentBp > 0) parts.push(t("BillingV2.percent_done", { percent: percentFromBp(m.percentBp) }));
    if (m.loggedMinutes > 0) parts.push(t("BillingV2.hours_logged", { hours: hoursFromMinutes(m.loggedMinutes) }));
    else if (!m.taskCount) return t("BillingV2.no_tasks_linked");
    else if (!m.percentBp) parts.push(t("BillingV2.not_started"));
    return parts.join(" · ");
};

const CHIP = {
    paid: "ah-chip--ok",
    invoiced: "ah-chip--warn",
    ready: "ah-chip--ok",
    in_progress: "ah-chip--brand",
    cancelled: "ah-chip--danger",
    not_due: "",
};
const stateChip = (state) => CHIP[state] || "";

const signOffName = (m) => m.signOffName || (m.signOffUserId ? m.signOffUserId.slice(-6) : "—");

const adding = ref(false);
const draft = reactive({ milestoneName: "", amount: "", dueDate: "" });
const errors = reactive({ milestoneName: "", amount: "" });

const openAdd = () => {
    adding.value = true;
    draft.milestoneName = "";
    draft.amount = "";
    draft.dueDate = "";
    errors.milestoneName = "";
    errors.amount = "";
};

const submitMilestone = async () => {
    errors.milestoneName = draft.milestoneName.trim() ? "" : t("BillingV2.milestone_name_required");
    const amount = Number(draft.amount);
    errors.amount = Number.isFinite(amount) && amount >= 0 && draft.amount !== "" ? "" : t("BillingV2.milestone_amount_required");
    if (errors.milestoneName || errors.amount) return;
    const result = await props.billing.addMilestone({
        milestoneName: draft.milestoneName.trim(),
        amount,
        dueDate: draft.dueDate || null,
    });
    if (result.ok) adding.value = false;
    else errors.milestoneName = result.message || t("BillingV2.save_failed");
};

const toggleRule = (key, event) => props.billing.saveContract({ [key]: event.target.checked });

const rateEditing = ref(false);
const rateDraft = ref("");
const submitRate = async () => {
    const value = Number(rateDraft.value);
    if (!Number.isFinite(value) || value <= 0) return;
    const result = await props.billing.saveContract({ blendedCostRateMinor: Math.round(value * 100) });
    if (result.ok) rateEditing.value = false;
};
</script>
