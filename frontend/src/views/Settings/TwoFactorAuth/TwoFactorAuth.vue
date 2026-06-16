<template>
    <div class="position-re mySettingsWrapper p-1">
        <SpinnerComp :is-spinner="isSpinner" />
        <div class="my-settings-main" :class="[{ 'pointer-events-none': isSpinner }]">
            <div class="row">
                <div class="col-md-2 settingprofile">
                    <div class="col-md-10 settingprofileform setting_profile_mobile_responsive">
                        <div class="profileform">
                            <div class="twofa-head">
                                <h3 class="twofa-title">{{ $t('Settings.two_factor_auth') }}</h3>
                                <p class="twofa-desc">{{ $t('Settings.two_factor_desc') }}</p>
                            </div>

                            <!-- IDLE: show current state + primary action -->
                            <div v-if="step === 'idle'" class="twofa-block">
                                <div class="twofa-status" :class="enabled ? 'is-on' : 'is-off'">
                                    <span class="twofa-dot"></span>
                                    <span>{{ enabled ? $t('Settings.two_factor_status_enabled') : $t('Settings.two_factor_status_disabled') }}</span>
                                </div>

                                <!-- Enable -->
                                <div v-if="!enabled" class="mysetiing_save">
                                    <button :disabled="isSpinner" @click.prevent="startEnroll()" class="btn_btn mysetting_save_btn">{{ $t('Settings.two_factor_enable') }}</button>
                                </div>

                                <!-- Disable (needs a current code or a recovery code) -->
                                <form v-else class="form_wrapper" @submit.prevent="disable2fa()">
                                    <div class="inputfield position-re">
                                        <label>{{ $t('Settings.two_factor_disable_label') }} *</label>
                                        <input type="text" class="logininput" placeHolder="123456" v-model.trim="disableCode" maxlength="20" autocomplete="off" />
                                        <div class="invalid-feedback red pt-5px">{{ disableError }}</div>
                                    </div>
                                    <div class="mysetiing_save">
                                        <button :disabled="isSpinner" class="btn_btn twofa-danger-btn" type="submit">{{ $t('Settings.two_factor_disable') }}</button>
                                    </div>
                                </form>
                            </div>

                            <!-- ENROLLING: QR + manual key + confirm code -->
                            <div v-else-if="step === 'enrolling'" class="twofa-block">
                                <p class="twofa-step-hint">{{ $t('Settings.two_factor_scan') }}</p>
                                <div class="twofa-qr-wrap">
                                    <img v-if="setupData.qrDataUrl" :src="setupData.qrDataUrl" alt="2FA QR code" class="twofa-qr" />
                                </div>
                                <p class="twofa-manual">{{ $t('Settings.two_factor_manual_key') }}</p>
                                <code class="twofa-key">{{ setupData.secret }}</code>

                                <form class="form_wrapper" @submit.prevent="verifyEnroll()">
                                    <div class="inputfield position-re mt-2">
                                        <label>{{ $t('Settings.two_factor_enter_code_enable') }} *</label>
                                        <input type="text" class="logininput" placeHolder="123456" v-model.trim="enrollCode" maxlength="6" autocomplete="off" />
                                        <div class="invalid-feedback red pt-5px">{{ enrollError }}</div>
                                    </div>
                                    <div class="mysetiing_save d-flex" style="gap:10px;">
                                        <button :disabled="isSpinner" class="btn_btn mysetting_save_btn" type="submit">{{ $t('Settings.two_factor_verify_enable') }}</button>
                                        <button :disabled="isSpinner" class="btn_btn twofa-ghost-btn" type="button" @click="cancelEnroll()">{{ $t('Settings.two_factor_cancel') }}</button>
                                    </div>
                                </form>
                            </div>

                            <!-- SHOW CODES: one-time recovery codes -->
                            <div v-else-if="step === 'showCodes'" class="twofa-block">
                                <h4 class="twofa-recovery-title">{{ $t('Settings.two_factor_recovery_title') }}</h4>
                                <p class="twofa-desc">{{ $t('Settings.two_factor_recovery_desc') }}</p>
                                <ul class="twofa-recovery-list">
                                    <li v-for="(code, i) in recoveryCodes" :key="i">{{ code }}</li>
                                </ul>
                                <div class="mysetiing_save d-flex" style="gap:10px;">
                                    <button class="btn_btn twofa-ghost-btn" type="button" @click="copyCodes()">{{ $t('Settings.two_factor_copy') }}</button>
                                    <button class="btn_btn twofa-ghost-btn" type="button" @click="downloadCodes()">{{ $t('Settings.two_factor_download') }}</button>
                                    <button class="btn_btn mysetting_save_btn" type="button" @click="finishEnroll()">{{ $t('Settings.two_factor_done') }}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import * as env from '@/config/env';
import { useToast } from 'vue-toast-notification';
import { ref, onMounted } from 'vue';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import { apiRequest } from '../../../services';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const $toast = useToast();

const isSpinner = ref(false);
const enabled = ref(false);
const step = ref('idle'); // 'idle' | 'enrolling' | 'showCodes'
const setupData = ref({ otpauthUrl: '', qrDataUrl: '', secret: '' });
const enrollCode = ref('');
const enrollError = ref('');
const disableCode = ref('');
const disableError = ref('');
const recoveryCodes = ref([]);

const fetchStatus = async () => {
    try {
        isSpinner.value = true;
        const res = await apiRequest('get', env.TWO_FA_STATUS);
        enabled.value = !!res?.data?.data?.enabled;
    } catch (error) {
        console.error('2FA status error', error);
    } finally {
        isSpinner.value = false;
    }
};

const startEnroll = async () => {
    try {
        isSpinner.value = true;
        enrollError.value = '';
        enrollCode.value = '';
        const res = await apiRequest('post', env.TWO_FA_SETUP, {});
        setupData.value = res?.data?.data || { otpauthUrl: '', qrDataUrl: '', secret: '' };
        step.value = 'enrolling';
    } catch (error) {
        console.error('2FA setup error', error);
        $toast.error(error?.response?.data?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const verifyEnroll = async () => {
    if (!enrollCode.value || !enrollCode.value.trim()) {
        enrollError.value = t('Auth.two_factor_enter_code');
        return;
    }
    try {
        isSpinner.value = true;
        enrollError.value = '';
        const res = await apiRequest('post', env.TWO_FA_VERIFY, { code: enrollCode.value.trim() });
        recoveryCodes.value = res?.data?.data?.recoveryCodes || [];
        enabled.value = true;
        step.value = 'showCodes';
        $toast.success(t('Toast.two_factor_enabled'), { position: 'top-right' });
    } catch (error) {
        enrollError.value = error?.response?.data?.message || t('Toast.two_factor_invalid');
    } finally {
        isSpinner.value = false;
    }
};

const cancelEnroll = () => {
    step.value = 'idle';
    enrollCode.value = '';
    enrollError.value = '';
    setupData.value = { otpauthUrl: '', qrDataUrl: '', secret: '' };
};

const finishEnroll = () => {
    step.value = 'idle';
    recoveryCodes.value = [];
    enrollCode.value = '';
    setupData.value = { otpauthUrl: '', qrDataUrl: '', secret: '' };
};

const disable2fa = async () => {
    if (!disableCode.value || !disableCode.value.trim()) {
        disableError.value = t('Auth.two_factor_enter_code');
        return;
    }
    try {
        isSpinner.value = true;
        disableError.value = '';
        await apiRequest('post', env.TWO_FA_DISABLE, { code: disableCode.value.trim() });
        enabled.value = false;
        disableCode.value = '';
        $toast.success(t('Toast.two_factor_disabled'), { position: 'top-right' });
    } catch (error) {
        disableError.value = error?.response?.data?.message || t('Toast.two_factor_invalid');
    } finally {
        isSpinner.value = false;
    }
};

const copyCodes = async () => {
    try {
        await navigator.clipboard.writeText(recoveryCodes.value.join('\n'));
        $toast.success(t('Toast.two_factor_codes_copied'), { position: 'top-right' });
    } catch (error) {
        console.error('copy failed', error);
    }
};

const downloadCodes = () => {
    const blob = new Blob([recoveryCodes.value.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alianhub-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

onMounted(fetchStatus);
</script>

<style scoped>
@import '../MySettings/style.css';
.twofa-head { margin-bottom: 18px; }
.twofa-title { font-size: 18px; font-weight: 600; color: #1F212A; margin: 0 0 4px; }
.twofa-desc { font-size: 13px; color: #6B7280; margin: 0; max-width: 520px; line-height: 1.5; }
.twofa-block { max-width: 420px; }
.twofa-status { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; margin-bottom: 16px; }
.twofa-status.is-on { background: #E7F7EC; color: #1B7F3B; }
.twofa-status.is-off { background: #F1F3F7; color: #6B7280; }
.twofa-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.twofa-step-hint { font-size: 13px; color: #374151; margin-bottom: 12px; line-height: 1.5; }
.twofa-qr-wrap { display: flex; justify-content: center; padding: 8px; background: #fff; border: 1px solid #EDF0F7; border-radius: 8px; width: 200px; }
.twofa-qr { width: 180px; height: 180px; image-rendering: pixelated; }
.twofa-manual { font-size: 12px; color: #6B7280; margin: 14px 0 4px; }
.twofa-key { display: inline-block; font-family: monospace; font-size: 14px; letter-spacing: 1px; background: #F1F3F7; padding: 6px 10px; border-radius: 6px; color: #1F212A; word-break: break-all; }
.twofa-recovery-title { font-size: 15px; font-weight: 600; color: #1F212A; margin: 0 0 4px; }
.twofa-recovery-list { list-style: none; padding: 12px 16px; margin: 12px 0; background: #FBFCFF; border: 1px dashed #C9D0F8; border-radius: 8px; columns: 2; column-gap: 24px; }
.twofa-recovery-list li { font-family: monospace; font-size: 14px; letter-spacing: 1px; color: #1F212A; padding: 3px 0; }
/* .btn_btn forces a navy background (!important), so secondary buttons just
   need readable white text to match the primary buttons. */
.twofa-ghost-btn { color: #fff; }
.twofa-danger-btn { background: #E5484D; color: #fff; }
</style>
