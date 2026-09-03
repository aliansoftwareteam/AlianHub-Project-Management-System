<template>
    <form class="ah-card billing__settings" @submit.prevent="submit">
        <div class="billing__settings-grid">
            <div class="ah-field">
                <label class="ah-field__label" for="bs-client">{{ $t('BillingV2.client_name') }}</label>
                <input id="bs-client" v-model="form.clientName" class="ah-input" maxlength="160" />
            </div>
            <div class="ah-field">
                <label class="ah-field__label" for="bs-vendor">{{ $t('BillingV2.vendor_name') }}</label>
                <input id="bs-vendor" v-model="form.vendorName" class="ah-input" maxlength="160" />
            </div>
            <div class="ah-field">
                <label class="ah-field__label" for="bs-tax-label">{{ $t('BillingV2.tax_label_field') }}</label>
                <input id="bs-tax-label" v-model="form.taxLabel" class="ah-input" maxlength="40" />
            </div>
            <div class="ah-field">
                <label class="ah-field__label" for="bs-tax">{{ $t('BillingV2.tax_rate_field') }}</label>
                <input id="bs-tax" v-model="form.taxPercent" class="ah-input" :class="{ 'ah-input--error': error }" type="number" min="0" max="100" step="0.01" />
                <span v-if="error" class="ah-field__error">{{ error }}</span>
            </div>
            <div class="ah-field">
                <label class="ah-field__label" for="bs-terms">{{ $t('BillingV2.payment_terms') }}</label>
                <input id="bs-terms" v-model="form.paymentTermsDays" class="ah-input" type="number" min="0" max="365" step="1" />
            </div>
            <div class="ah-field">
                <label class="ah-field__label" for="bs-rate">{{ $t('BillingV2.cost_rate_label') }}</label>
                <input id="bs-rate" v-model="form.costRate" class="ah-input" type="number" min="0" step="0.01" />
                <span class="ah-field__hint">{{ $t('BillingV2.cost_rate_hint') }}</span>
            </div>
        </div>
        <div class="billing__settings-foot">
            <label class="billing__rule">
                <input v-model="form.allowClientMessages" type="checkbox" class="ah-check" />
                <span>{{ $t('BillingV2.message_hint') }}</span>
            </label>
            <span class="ah-toolbar__spacer"></span>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="$emit('close')">{{ $t('BillingV2.cancel') }}</button>
            <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="saving">{{ $t('BillingV2.save') }}</button>
        </div>
    </form>
</template>

<script setup>
import { reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

defineOptions({ name: "BillingSettings" });

const props = defineProps({
    contract: { type: Object, required: true },
    saving: { type: Boolean, default: false },
});
const emit = defineEmits(["save", "close"]);

const { t } = useI18n();
const error = ref("");

const form = reactive({
    clientName: props.contract.clientName,
    vendorName: props.contract.vendorName,
    taxLabel: props.contract.taxLabel,
    taxPercent: props.contract.taxRateBp ? props.contract.taxRateBp / 100 : "",
    paymentTermsDays: props.contract.paymentTermsDays,
    costRate: props.contract.blendedCostRateMinor ? props.contract.blendedCostRateMinor / 100 : "",
    allowClientMessages: props.contract.allowClientMessages,
});

const submit = () => {
    const percent = form.taxPercent === "" ? 0 : Number(form.taxPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        error.value = t("BillingV2.save_failed");
        return;
    }
    error.value = "";
    emit("save", {
        clientName: form.clientName,
        vendorName: form.vendorName,
        taxLabel: form.taxLabel,
        taxRateBp: Math.round(percent * 100),
        paymentTermsDays: Number(form.paymentTermsDays) || 0,
        blendedCostRateMinor: form.costRate === "" ? null : Math.round(Number(form.costRate) * 100),
        allowClientMessages: form.allowClientMessages,
    });
};
</script>
