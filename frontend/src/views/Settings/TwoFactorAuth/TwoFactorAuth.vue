<template>
    <div class="tfa" :class="{ 'tfa--busy': isSpinner }">
        <SpinnerComp :is-spinner="isSpinner" />

        <section class="ah-card tfa__card">
            <div class="ah-card__body tfa__body">
                <div>
                    <h2 class="ah-h3 tfa__title">{{ $t('Settings.tfa_title') }}</h2>
                    <div class="ah-small">{{ $t('Settings.tfa_subtitle') }}</div>
                </div>

                <template v-if="step === 'idle'">
                    <div class="tfa__status">
                        <span class="ah-chip" :class="enabled ? 'ah-chip--ok' : ''">{{ enabled ? $t('Settings.tfa_on') : $t('Settings.tfa_off') }}</span>
                        <span class="ah-small">{{ enabled ? $t('Settings.tfa_on_hint') : $t('Settings.tfa_off_hint') }}</span>
                    </div>
                    <div v-if="!enabled" class="tfa__actions">
                        <button type="button" class="ah-btn ah-btn--primary" :disabled="isSpinner" @click="startEnroll()">{{ $t('Settings.tfa_set_up') }}</button>
                    </div>
                    <form v-else class="tfa__disable" @submit.prevent="disable2fa()">
                        <div class="ah-field">
                            <label class="ah-field__label" for="tfa-disable-code">{{ $t('Settings.two_factor_disable_label') }}</label>
                            <input id="tfa-disable-code" class="ah-input ah-mono tfa__code-input" :class="{ 'ah-input--error': disableError }" v-model.trim="disableCode" maxlength="20" autocomplete="one-time-code" inputmode="numeric" @input="disableError = ''" />
                            <div v-if="disableError" class="ah-field__error">{{ disableError }}</div>
                        </div>
                        <div class="tfa__actions">
                            <button type="submit" class="ah-btn ah-btn--danger" :disabled="isSpinner">{{ $t('Settings.tfa_turn_off') }}</button>
                        </div>
                    </form>
                </template>

                <template v-else-if="step === 'enrolling'">
                    <div class="tfa__setup">
                        <div class="tfa__qr">
                            <img v-if="setupData.qrDataUrl" :src="setupData.qrDataUrl" :alt="$t('Settings.tfa_qr_alt')" />
                            <div v-else class="ah-empty tfa__qr-empty">{{ $t('Settings.tfa_qr_missing') }}</div>
                        </div>
                        <ol class="tfa__steps">
                            <li><strong>1.</strong> {{ $t('Settings.tfa_step_scan') }}</li>
                            <li>
                                <strong>2.</strong> {{ $t('Settings.tfa_step_key') }}
                                <div class="tfa__key">
                                    <span class="ah-mono">{{ groupedSecret }}</span>
                                    <button type="button" class="tfa__copy" @click="copyText(setupData.secret, 'Settings.tfa_key_copied')">{{ $t('Settings.copy') }}</button>
                                </div>
                            </li>
                        </ol>
                    </div>
                    <form @submit.prevent="verifyEnroll()">
                        <div class="ah-field">
                            <span class="ah-field__label" id="tfa-digits-label">3. {{ $t('Settings.two_factor_enter_code_enable') }}</span>
                            <div class="tfa__digits" role="group" aria-labelledby="tfa-digits-label">
                                <input
                                    v-for="(d, i) in digits"
                                    :key="i"
                                    :ref="(el) => setDigitRef(el, i)"
                                    class="tfa__digit"
                                    :class="{ 'is-filled': d !== '', 'is-error': enrollError }"
                                    type="text"
                                    inputmode="numeric"
                                    maxlength="1"
                                    autocomplete="one-time-code"
                                    :aria-label="$t('Settings.tfa_digit', { n: i + 1 })"
                                    :value="d"
                                    @input="onDigitInput(i, $event)"
                                    @keydown="onDigitKey(i, $event)"
                                    @paste.prevent="onPaste($event)"
                                />
                            </div>
                            <div v-if="enrollError" class="ah-field__error">{{ enrollError }}</div>
                        </div>
                        <div class="tfa__warn">
                            <strong>{{ $t('Settings.tfa_recovery_warn_title') }}</strong> {{ $t('Settings.tfa_recovery_warn') }}
                        </div>
                        <div class="tfa__actions">
                            <button type="submit" class="ah-btn ah-btn--primary" :disabled="isSpinner || code.length < 6">{{ $t('Settings.tfa_turn_on') }}</button>
                            <button type="button" class="ah-btn ah-btn--secondary" :disabled="isSpinner" @click="cancelEnroll()">{{ $t('Settings.two_factor_cancel') }}</button>
                            <span class="ah-small tfa__fallback">{{ $t('Settings.tfa_owner_fallback') }}</span>
                        </div>
                    </form>
                </template>

                <template v-else-if="step === 'showCodes'">
                    <div class="tfa__warn">
                        <strong>{{ $t('Settings.tfa_recovery_warn_title') }}</strong> {{ $t('Settings.tfa_recovery_warn') }}
                    </div>
                    <ul class="tfa__codes">
                        <li v-for="(c, i) in recoveryCodes" :key="i" class="ah-mono">{{ c }}</li>
                    </ul>
                    <div class="tfa__actions">
                        <button type="button" class="ah-btn ah-btn--secondary" @click="copyText(recoveryCodes.join('\n'), 'Toast.two_factor_codes_copied')"><ShellIcon name="copy" :size="14" />{{ $t('Settings.copy_codes') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary" @click="downloadCodes()"><ShellIcon name="download" :size="14" />{{ $t('Settings.download_codes') }}</button>
                        <button type="button" class="ah-btn ah-btn--primary" @click="finishEnroll()">{{ $t('Settings.tfa_saved_them') }}</button>
                    </div>
                </template>
            </div>
        </section>

        <section class="ah-card tfa__card">
            <div class="ah-card__head">
                <h2 class="ah-h3">{{ $t('Settings.tfa_lost_title') }}</h2>
            </div>
            <div class="ah-card__body tfa__lost">
                <p>{{ $t('Settings.tfa_lost_1') }}</p>
                <p>{{ $t('Settings.tfa_lost_2') }}</p>
                <p>{{ $t('Settings.tfa_lost_3') }}</p>
                <router-link class="ah-btn ah-btn--secondary ah-btn--sm tfa__pw" :to="{ name: 'changePassword', params: { cid: companyId } }">
                    <ShellIcon name="key" :size="14" />{{ $t('settingslider.Change Password') }}
                </router-link>
            </div>
        </section>
    </div>
</template>

<script setup>
import { ref, computed, inject, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import SpinnerComp from "@/components/atom/SpinnerComp/SpinnerComp.vue";

defineOptions({ name: "TwoFactorAuthView" });

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");

const CODE_LENGTH = 6;
const isSpinner = ref(false);
const enabled = ref(false);
const step = ref("idle");
const setupData = ref({ otpauthUrl: "", qrDataUrl: "", secret: "" });
const digits = ref(Array(CODE_LENGTH).fill(""));
const digitRefs = [];
const enrollError = ref("");
const disableCode = ref("");
const disableError = ref("");
const recoveryCodes = ref([]);

const code = computed(() => digits.value.join(""));
const groupedSecret = computed(() => String(setupData.value.secret || "").replace(/(.{4})/g, "$1 ").trim());

const setDigitRef = (el, i) => { if (el) digitRefs[i] = el; };
const focusDigit = (i) => digitRefs[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus();

function onDigitInput(i, event) {
    const v = String(event.target.value || "").replace(/\D/g, "");
    digits.value[i] = v.slice(-1);
    event.target.value = digits.value[i];
    enrollError.value = "";
    if (digits.value[i] && i < CODE_LENGTH - 1) focusDigit(i + 1);
}

function onDigitKey(i, event) {
    if (event.key === "Backspace" && !digits.value[i] && i > 0) { digits.value[i - 1] = ""; focusDigit(i - 1); }
    if (event.key === "ArrowLeft") focusDigit(i - 1);
    if (event.key === "ArrowRight") focusDigit(i + 1);
}

function onPaste(event) {
    const text = (event.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!text) return;
    digits.value = Array.from({ length: CODE_LENGTH }, (_, i) => text[i] || "");
    focusDigit(text.length);
}

const resetDigits = () => { digits.value = Array(CODE_LENGTH).fill(""); };

async function fetchStatus() {
    isSpinner.value = true;
    try {
        const res = await apiRequest("get", env.TWO_FA_STATUS);
        enabled.value = !!res?.data?.data?.enabled;
    } catch (error) {
        $toast.error(error?.response?.data?.message || t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        isSpinner.value = false;
    }
}

async function startEnroll() {
    isSpinner.value = true;
    enrollError.value = "";
    resetDigits();
    try {
        const res = await apiRequest("post", env.TWO_FA_SETUP, {});
        setupData.value = res?.data?.data || { otpauthUrl: "", qrDataUrl: "", secret: "" };
        step.value = "enrolling";
        setTimeout(() => focusDigit(0));
    } catch (error) {
        $toast.error(error?.response?.data?.message || t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        isSpinner.value = false;
    }
}

async function verifyEnroll() {
    if (code.value.length < CODE_LENGTH) { enrollError.value = t("Auth.two_factor_enter_code"); return; }
    isSpinner.value = true;
    enrollError.value = "";
    try {
        const res = await apiRequest("post", env.TWO_FA_VERIFY, { code: code.value });
        recoveryCodes.value = res?.data?.data?.recoveryCodes || [];
        enabled.value = true;
        step.value = "showCodes";
    } catch (error) {
        enrollError.value = error?.response?.data?.message || t("Toast.two_factor_invalid");
    } finally {
        isSpinner.value = false;
    }
}

function cancelEnroll() {
    step.value = "idle";
    resetDigits();
    enrollError.value = "";
    setupData.value = { otpauthUrl: "", qrDataUrl: "", secret: "" };
}

function finishEnroll() {
    step.value = "idle";
    recoveryCodes.value = [];
    resetDigits();
    setupData.value = { otpauthUrl: "", qrDataUrl: "", secret: "" };
}

async function disable2fa() {
    if (!disableCode.value) { disableError.value = t("Auth.two_factor_enter_code"); return; }
    isSpinner.value = true;
    disableError.value = "";
    try {
        await apiRequest("post", env.TWO_FA_DISABLE, { code: disableCode.value });
        enabled.value = false;
        disableCode.value = "";
        $toast.success(t("Toast.two_factor_disabled"), { position: "top-right" });
    } catch (error) {
        disableError.value = error?.response?.data?.message || t("Toast.two_factor_invalid");
    } finally {
        isSpinner.value = false;
    }
}

async function copyText(text, toastKey) {
    try {
        await navigator.clipboard.writeText(text);
        $toast.success(t(toastKey), { position: "top-right" });
    } catch (error) {
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    }
}

function downloadCodes() {
    const blob = new Blob([recoveryCodes.value.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "alianhub-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

onMounted(fetchStatus);
</script>

<style scoped>
.tfa { display: flex; flex-direction: column; gap: 12px; max-width: 552px; position: relative; }
.tfa--busy { pointer-events: none; }
.tfa__body { display: flex; flex-direction: column; gap: 14px; }
.tfa__title { font-size: 15px; }
.tfa__status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tfa__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tfa__fallback { margin-left: auto; }
.tfa__disable { display: flex; flex-direction: column; gap: 12px; max-width: 320px; }
.tfa__code-input { letter-spacing: .12em; }
.tfa__setup { display: flex; gap: 16px; }
.tfa__qr { width: 120px; height: 120px; flex: none; border: 1px solid var(--border); border-radius: 10px; padding: 8px; background: #fff; }
.tfa__qr img { width: 100%; height: 100%; image-rendering: pixelated; display: block; }
.tfa__qr-empty { padding: 8px; font-size: 11px; height: 100%; box-sizing: border-box; }
.tfa__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font: var(--text-small); color: var(--ink); line-height: 1.5; }
.tfa__key { margin-top: 4px; padding: 6px 9px; background: var(--surface-2); border-radius: 7px; display: flex; align-items: center; gap: 8px; }
.tfa__copy { margin-left: auto; border: 0; background: transparent; color: var(--brand); font: 600 12px/1 var(--font-ui); cursor: pointer; padding: 4px; }
.tfa__copy:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 4px; }
.tfa__digits { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; max-width: 300px; }
.tfa__digit {
    height: 44px; width: 100%; box-sizing: border-box; text-align: center; border: 1px solid var(--border); border-radius: 8px;
    background: var(--surface); color: var(--ink); font: 600 17px/1 var(--font-mono);
    transition: border-color var(--t-state) var(--ease), box-shadow var(--t-state) var(--ease);
}
.tfa__digit.is-filled { border: 1.5px solid var(--brand); }
.tfa__digit:focus { outline: none; border: 1.5px solid var(--brand); box-shadow: var(--focus); }
.tfa__digit.is-error { border-color: var(--danger); }
.tfa__warn { padding: 12px 14px; background: var(--warn-bg); border-radius: 10px; font: var(--text-small); line-height: 1.55; color: var(--warn-ink); }
.tfa__codes { list-style: none; margin: 0; padding: 12px 16px; background: var(--surface-2); border: 1px dashed var(--border); border-radius: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
.tfa__codes li { font-size: 13px; letter-spacing: .06em; color: var(--ink); }
.tfa__lost { display: flex; flex-direction: column; gap: 8px; font: var(--text-small); color: var(--ink-label); }
.tfa__lost p { margin: 0; line-height: 1.55; }
.tfa__pw { align-self: flex-start; text-decoration: none; }
@media (max-width: 767px) {
    .tfa__setup { flex-direction: column; }
    .tfa__fallback { margin-left: 0; }
}
</style>
