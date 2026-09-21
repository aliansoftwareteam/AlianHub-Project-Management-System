<template>
    <section v-if="available" class="ah-card sec" data-test="secrets-list" aria-labelledby="secrets-title">
        <div class="ah-card__head">
            <h3 id="secrets-title" class="ah-h3">{{ $t('Secrets.title') }}</h3>
            <span class="ah-mono ah-small">{{ $t('Secrets.count', { n: secrets.length }) }}</span>
        </div>
        <div class="ah-card__body sec__body">
            <p class="ah-small">{{ $t('Secrets.lead') }}</p>
            <p v-if="!secrets.length" class="ah-empty" data-test="secrets-empty">{{ $t('Secrets.empty') }}</p>
            <div v-else class="sec__scroll">
                <table class="sec__table">
                    <thead>
                        <tr>
                            <th>{{ $t('Secrets.col_name') }}</th>
                            <th>{{ $t('Secrets.col_kind') }}</th>
                            <th>{{ $t('Secrets.col_key') }}</th>
                            <th>{{ $t('Secrets.col_created') }}</th>
                            <th>{{ $t('Secrets.col_rotated') }}</th>
                            <th>{{ $t('Secrets.col_resolved') }}</th>
                            <th>{{ $t('Secrets.col_status') }}</th>
                            <th><span class="sec__sr">{{ $t('Secrets.col_actions') }}</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="s in secrets" :key="s.handle">
                            <tr data-test="secret-row" :data-handle="s.handle" :class="{ 'is-revoked': s.revokedAt }">
                                <td class="sec__name" data-test="secret-name">{{ s.name }}</td>
                                <td data-test="secret-kind">{{ kindLabel(s.kind) }}</td>
                                <td class="ah-mono" data-test="secret-key">{{ s.keyId }}<span v-if="keyId && s.keyId !== keyId" class="ah-chip ah-chip--warn ah-chip--mono sec__chip">{{ $t('Secrets.key_previous') }}</span></td>
                                <td class="ah-mono" data-test="secret-created">{{ when(s.createdAt) }}</td>
                                <td class="ah-mono" data-test="secret-rotated">{{ when(s.rotatedAt) }}</td>
                                <td class="ah-mono" data-test="secret-resolved">{{ when(s.lastResolvedAt) }}</td>
                                <td data-test="secret-status">
                                    <span class="ah-chip ah-chip--mono" :class="s.revokedAt ? 'ah-chip--danger' : 'ah-chip--ok'">{{ s.revokedAt ? $t('Secrets.status_revoked') : $t('Secrets.status_active') }}</span>
                                </td>
                                <td class="sec__actions">
                                    <template v-if="!s.revokedAt">
                                        <button type="button" class="sec__link" data-test="secret-rotate" :disabled="busy" @click="startRotate(s)">{{ rotating === s.handle ? $t('Secrets.cancel') : $t('Secrets.rotate') }}</button>
                                        <button type="button" class="sec__link sec__link--danger" data-test="secret-revoke" :disabled="busy" @click="revoke(s)">{{ $t('Secrets.revoke') }}</button>
                                    </template>
                                </td>
                            </tr>
                            <tr v-if="rotating === s.handle" class="sec__rotate-row">
                                <td colspan="8">
                                    <form class="sec__rotate" data-test="rotate-form" @submit.prevent="submitRotate(s)">
                                        <label class="ah-field__label" :for="'sec-value-' + s.handle">{{ $t('Secrets.new_value', { name: s.name }) }}</label>
                                        <input :id="'sec-value-' + s.handle" class="ah-input ah-mono" type="password" autocomplete="new-password" data-test="rotate-input" v-model="newValue" :placeholder="$t('Secrets.new_value_ph')" @input="rotateError = ''" />
                                        <div v-if="rotateError" class="ah-field__error" data-test="rotate-error">{{ rotateError }}</div>
                                        <div class="sec__rotate-actions">
                                            <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy">{{ $t('Secrets.save') }}</button>
                                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="stopRotate">{{ $t('Secrets.cancel') }}</button>
                                        </div>
                                    </form>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
        </div>
    </section>
</template>

<script setup>
defineOptions({ name: 'StoredSecrets' });
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import * as env from '@/config/env';
import { apiRequest } from '@/services';

const { t } = useI18n();
const $toast = useToast();

const available = ref(false);
const secrets = ref([]);
const keyId = ref('');
const busy = ref(false);
const rotating = ref('');
const newValue = ref('');
const rotateError = ref('');

const ok = (res) => Boolean(res && res.data && res.data.status);
const when = (d) => (d ? new Date(d).toLocaleString() : t('Secrets.never'));
const kindLabel = (kind) => (kind === 'integration' || kind === 'webhook' ? t(`Secrets.kind_${kind}`) : kind);
const replace = (row) => { secrets.value = secrets.value.map((s) => (s.handle === row.handle ? { ...s, ...row } : s)); };
const problem = (res) => (res && res.data && res.data.statusText) || t('Toast.something_went_wrong');

/* A refusal or a 404 (store off, or not an owner or admin) leaves the panel unrendered. */
const load = async () => {
    try {
        const res = await apiRequest('get', env.SECRETS);
        if (!ok(res)) { available.value = false; return; }
        secrets.value = res.data.data || [];
        keyId.value = res.data.keyId || '';
        available.value = true;
    } catch (e) {
        available.value = false;
    }
};

const stopRotate = () => { rotating.value = ''; newValue.value = ''; rotateError.value = ''; };
const startRotate = (s) => { if (rotating.value === s.handle) { stopRotate(); return; } stopRotate(); rotating.value = s.handle; };

const submitRotate = async (s) => {
    const value = newValue.value;
    if (!value || !value.trim()) { rotateError.value = t('Secrets.err_value'); return; }
    busy.value = true;
    try {
        const res = await apiRequest('post', `${env.SECRETS}/${s.handle}/rotate`, { value });
        if (!ok(res)) { $toast.error(problem(res), { position: 'top-right' }); return; }
        replace(res.data.data || { handle: s.handle });
        $toast.success(t('Secrets.rotated_toast', { name: s.name }), { position: 'top-right' });
        stopRotate();
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        newValue.value = '';
        busy.value = false;
    }
};

const revoke = async (s) => {
    if (!window.confirm(t('Secrets.confirm_revoke', { name: s.name }))) return;
    busy.value = true;
    try {
        const res = await apiRequest('post', `${env.SECRETS}/${s.handle}/revoke`, {});
        if (!ok(res)) { $toast.error(problem(res), { position: 'top-right' }); return; }
        replace(res.data.data || { handle: s.handle, revokedAt: new Date().toISOString() });
        if (rotating.value === s.handle) stopRotate();
        $toast.success(t('Secrets.revoked_toast', { name: s.name }), { position: 'top-right' });
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        busy.value = false;
    }
};

onMounted(load);
</script>

<style scoped>
.sec__body { display: flex; flex-direction: column; gap: 10px; }
.sec__scroll { overflow-x: auto; }
.sec__table { width: 100%; border-collapse: collapse; font: var(--text-small); }
.sec__table th { text-align: left; font: var(--text-label); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); padding: 4px 8px; border-bottom: 1px solid var(--hairline); white-space: nowrap; }
.sec__table td { padding: 6px 8px; border-bottom: 1px solid var(--hairline); color: var(--ink); vertical-align: middle; white-space: nowrap; }
.sec__name { font-weight: 600; white-space: normal; min-width: 180px; }
.is-revoked td { color: var(--ink-3); }
.sec__chip { margin-left: 6px; }
.sec__actions { text-align: right; }
.sec__link { border: 0; background: transparent; color: var(--brand); font: 600 12px/1 var(--font-ui); cursor: pointer; padding: 4px 2px; margin-left: 8px; }
.sec__link--danger { color: var(--danger-ink); }
.sec__link:disabled { opacity: .5; cursor: default; }
.sec__link:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 4px; }
.sec__rotate-row td { background: var(--surface-2); white-space: normal; }
.sec__rotate { display: flex; flex-direction: column; gap: 6px; max-width: 520px; }
.sec__rotate-actions { display: flex; gap: 8px; }
.sec__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
