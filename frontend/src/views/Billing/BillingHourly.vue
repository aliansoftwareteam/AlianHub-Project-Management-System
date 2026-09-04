<template>
    <div class="billing__hourly">
        <div class="billing__hourly-head">
            <span class="ah-h3">{{ $t('Billing.hourly_title') }}</span>
            <span class="ah-mono billing__month">{{ monthLabel(hourly.month) }}</span>
            <span class="ah-toolbar__spacer"></span>
            <input class="ah-input billing__month-input" type="month" :value="hourly.month" @change="billing.loadHourly($event.target.value)" />
        </div>

        <p v-if="hourly.loading && !hourly.data" class="billing__state">{{ $t('Billing.loading') }}</p>
        <div v-else-if="hourly.error" class="ah-empty">{{ $t('Billing.load_failed') }}</div>

        <template v-else-if="hourly.data">
            <div class="ah-card billing__rates">
                <div class="billing__rates-head">
                    <span class="ah-h3">{{ $t('Billing.rates') }}</span>
                    <span class="ah-small billing__rates-hint">{{ $t('Billing.rates_hint') }}</span>
                </div>
                <div v-if="!hourly.data.ratesConfigured" class="ah-empty billing__empty">{{ $t('Billing.no_rates') }}</div>
                <template v-else>
                    <div class="billing__rate-row billing__rate-row--head">
                        <span>{{ $t('Billing.col_person') }}</span>
                        <span>{{ $t('Billing.col_rate') }}</span>
                        <span>{{ $t('Billing.col_approved') }}</span>
                        <span>{{ $t('Billing.col_value') }}</span>
                    </div>
                    <div v-if="!people.length" class="ah-empty billing__empty">{{ $t('Billing.no_hourly_data', { month: monthLabel(hourly.month) }) }}</div>
                    <div v-for="person in people" :key="person.userId" class="billing__rate-row">
                        <span class="billing__person">
                            <span class="ah-avatar ah-avatar--sm">{{ initial(person.name) }}</span>
                            {{ person.name || person.userId.slice(-6) }}
                        </span>
                        <span v-if="person.hasRate" class="ah-mono">{{ money(person.rateMinor, symbol) }}</span>
                        <span v-else class="ah-small billing__no-rate">{{ $t('Billing.no_rate_for_person') }}</span>
                        <span class="ah-mono">{{ hoursFromMinutes(person.approvedMinutes) }}h</span>
                        <span class="billing__figure">{{ money(person.approvedMinor, symbol) }}</span>
                    </div>
                    <div v-if="hourly.data.pendingMinutes" class="billing__rate-row billing__rate-row--pending">
                        <span>{{ $t('Billing.pending_approval') }}</span>
                        <span></span>
                        <span class="ah-mono">{{ hoursFromMinutes(hourly.data.pendingMinutes) }}h</span>
                        <span class="billing__figure">{{ money(hourly.data.pendingMinor, symbol) }}</span>
                    </div>
                </template>
            </div>

            <div class="ah-card billing__cap">
                <div class="billing__cap-head">
                    <span class="ah-h3">{{ $t('Billing.monthly_cap') }}</span>
                    <span v-if="cap.hasCap" class="billing__figure">{{ money(cap.capMinor, symbol) }}</span>
                </div>

                <template v-if="cap.hasCap">
                    <div class="billing__cap-bar">
                        <span class="billing__cap-approved" :style="{ width: `${Math.min(100, percentFromBp(cap.approvedBp) || 0)}%` }"></span>
                        <span class="billing__cap-pending" :style="{ width: `${Math.min(100, percentFromBp(cap.pendingBp) || 0)}%` }"></span>
                    </div>
                    <div class="billing__cap-legend">
                        <span><i class="billing__key billing__key--approved"></i>{{ $t('Billing.legend_approved', { amount: money(cap.approvedMinor, symbol) }) }}</span>
                        <span><i class="billing__key billing__key--pending"></i>{{ $t('Billing.legend_pending', { amount: money(cap.pendingMinor, symbol) }) }}</span>
                        <span class="billing__headroom">
                            {{ cap.overCap
                                ? $t('Billing.over_cap', { amount: money(-cap.headroomMinor, symbol) })
                                : $t('Billing.headroom', { amount: money(cap.headroomMinor, symbol) }) }}
                        </span>
                    </div>
                    <p v-if="capWarning" class="billing__watch">
                        <strong>{{ $t('Billing.cap_warning_title') }}</strong>
                        {{ $t('Billing.cap_warning_body', {
                            hours: hoursFromMinutes(hourly.data.pendingMinutes),
                            left: money(Math.max(0, cap.headroomMinor), symbol),
                        }) }}
                    </p>
                </template>
                <div v-else class="billing__rate-empty">
                    <p class="ah-small">{{ $t('Billing.no_cap') }}</p>
                    <form v-if="capEditing" class="ah-field" @submit.prevent="submitCap">
                        <label class="ah-field__label" for="cap-input">{{ $t('Billing.cap_label') }}</label>
                        <input id="cap-input" v-model="capDraft" class="ah-input" type="number" min="0" step="1" />
                        <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm">{{ $t('Billing.save') }}</button>
                    </form>
                    <button v-else type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="capEditing = true">{{ $t('Billing.set_cap') }}</button>
                </div>
            </div>

            <div class="billing__hourly-actions">
                <button type="button" class="ah-btn ah-btn--primary" :disabled="busy" @click="generate">
                    {{ $t('Billing.generate_month_invoice', { month: monthLabel(hourly.month) }) }}
                </button>
                <router-link v-if="hourly.data.pendingMinutes" class="ah-btn ah-btn--secondary" :to="{ name: 'Approvals', params: { cid: companyId } }">
                    {{ $t('Billing.approve_first', { hours: hoursFromMinutes(hourly.data.pendingMinutes) }) }}
                </router-link>
                <span class="ah-toolbar__spacer"></span>
                <span class="ah-small">{{ $t('Billing.non_billable_excluded') }}</span>
            </div>
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useToast } from "vue-toast-notification";
import { hoursFromMinutes, money, monthLabel, percentFromBp } from "./useBilling";

defineOptions({ name: "BillingHourly" });

const props = defineProps({ billing: { type: Object, required: true } });
const $toast = useToast();
const companyId = inject("$companyId");

const hourly = computed(() => props.billing.hourly);
const busy = computed(() => props.billing.saving.value);
const symbol = computed(() => (hourly.value.data && hourly.value.data.contract.currencySymbol) || "$");
const people = computed(() => (hourly.value.data && hourly.value.data.people) || []);
const cap = computed(() => (hourly.value.data && hourly.value.data.cap) || { hasCap: false });
const capWarning = computed(() => cap.value.hasCap && (cap.value.overCap || (cap.value.headroomMinor !== null && cap.value.headroomMinor < cap.value.capMinor * 0.1)));

const initial = (name) => String(name || "?").trim().charAt(0).toUpperCase() || "?";

const capEditing = ref(false);
const capDraft = ref("");
const submitCap = async () => {
    const value = Number(capDraft.value);
    if (!Number.isFinite(value) || value <= 0) return;
    const result = await props.billing.saveContract({ monthlyCapMinor: Math.round(value * 100) });
    if (result.ok) {
        capEditing.value = false;
        props.billing.loadHourly();
    }
};

const generate = async () => {
    const result = await props.billing.draftFromMonth(hourly.value.month);
    if (result.ok) $toast.success(result.message);
    else $toast.error(result.message);
};

onMounted(() => { if (!hourly.value.data) props.billing.loadHourly(); });
</script>
