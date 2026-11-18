<template>
    <section v-if="privileged" class="ah-card rp__card" data-test="provider-keys" aria-labelledby="provider-keys-title">
        <div class="rp__head">
            <span id="provider-keys-title" class="rp__title">{{ $t('ProviderKeys.title') }}</span>
        </div>
        <p class="ah-small rp__lead">{{ $t('ProviderKeys.lead') }}</p>
        <div v-if="offNote" class="rp__banner rp__banner--warn" data-test="keys-off">
            <ShellIcon name="alert" :size="15" /><span>{{ offNote }}</span>
        </div>
        <div v-else-if="!loaded" class="ah-empty">{{ $t('ProviderKeys.loading') }}</div>
        <template v-else>
            <div v-for="row in rows" :key="row.provider" class="rp__field" :data-test="`provider-${row.provider}`">
                <div>
                    <span class="rp__label">{{ providerLabel(row.provider) }}</span>
                    <div class="rp__help ah-mono" data-test="key-state">
                        <template v-if="row.set">{{ row.keyId }} · {{ $t('ProviderKeys.resolved', { when: when(row.lastResolvedAt) }) }}</template>
                        <template v-else-if="row.stale">{{ $t('ProviderKeys.status_stale') }}</template>
                        <template v-else>{{ $t('ProviderKeys.status_instance') }}</template>
                    </div>
                </div>
                <div class="rp__control rp__keys-actions">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" data-test="key-set" @click="toggle(row)">
                        {{ editing === row.provider ? $t('ProviderKeys.cancel') : row.set ? $t('ProviderKeys.replace') : $t('ProviderKeys.set') }}
                    </button>
                    <button v-if="row.set" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="key-clear" @click="clear(row)">{{ $t('ProviderKeys.clear') }}</button>
                </div>
            </div>
            <form v-if="editing" class="rp__keys-form" data-test="key-form" @submit.prevent="submit">
                <label class="ah-field__label" :for="`pk-value-${editing}`">{{ $t('ProviderKeys.new_value', { name: providerLabel(editing) }) }}</label>
                <input :id="`pk-value-${editing}`" v-model="newValue" class="ah-input ah-mono" type="password" autocomplete="new-password" data-test="key-input" :placeholder="$t('ProviderKeys.new_value_ph')" @input="formError = ''" />
                <div v-if="formError" class="ah-field__error" data-test="key-error">{{ formError }}</div>
                <div class="rp__actions">
                    <div class="ah-toolbar__spacer"></div>
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" data-test="key-save">{{ $t('ProviderKeys.save') }}</button>
                </div>
            </form>
        </template>
    </section>
</template>

<script setup>
defineOptions({ name: 'ProviderKeys' });
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { reasonOf } from '@/views/Ai/useAgents';
import { isOwnerOrAdmin } from '@/utils/roles';

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();

const LABELS = { openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', google: 'Google' };

const loaded = ref(false);
const busy = ref(false);
const offNote = ref('');
const rows = ref([]);
const editing = ref('');
const newValue = ref('');
const formError = ref('');

const privileged = computed(() => isOwnerOrAdmin(Number(getters['settings/companyUserDetail']?.roleType)));
const providerLabel = (provider) => LABELS[provider] || provider;
const when = (d) => (d ? new Date(d).toLocaleString() : t('ProviderKeys.never'));
const problem = (res) => (res && res.data && res.data.statusText) || t('Toast.something_went_wrong');

const load = async () => {
    if (!privileged.value) return;
    try {
        const res = await apiRequest('get', env.PROVIDER_KEYS);
        if (res?.data?.status !== true) {
            offNote.value = res?.data?.storeOff ? t('ProviderKeys.flag_off') : problem(res);
            return;
        }
        rows.value = res.data.data || [];
        loaded.value = true;
    } catch (e) {
        offNote.value = reasonOf(e, 'ProviderKeys.load_failed');
    }
};

const stopEditing = () => { editing.value = ''; newValue.value = ''; formError.value = ''; };
const toggle = (row) => {
    if (editing.value === row.provider) { stopEditing(); return; }
    stopEditing();
    editing.value = row.provider;
};

const submit = async () => {
    const value = newValue.value;
    if (!value || !value.trim()) { formError.value = t('ProviderKeys.err_value'); return; }
    busy.value = true;
    try {
        const res = await apiRequest('put', `${env.PROVIDER_KEYS}/${editing.value}`, { value });
        if (res?.data?.status !== true) { $toast.error(problem(res), { position: 'top-right' }); return; }
        const saved = res.data.data || { provider: editing.value, set: true };
        rows.value = rows.value.map((row) => (row.provider === saved.provider ? { ...row, ...saved } : row));
        $toast.success(t('ProviderKeys.saved_toast', { name: providerLabel(saved.provider) }), { position: 'top-right' });
        stopEditing();
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        newValue.value = '';
        busy.value = false;
    }
};

const clear = async (row) => {
    const name = providerLabel(row.provider);
    if (!window.confirm(t('ProviderKeys.confirm_clear', { name }))) return;
    busy.value = true;
    try {
        const res = await apiRequest('delete', `${env.PROVIDER_KEYS}/${row.provider}`);
        if (res?.data?.status !== true) { $toast.error(problem(res), { position: 'top-right' }); return; }
        rows.value = rows.value.map((r) => (r.provider === row.provider ? { provider: r.provider, set: false } : r));
        if (editing.value === row.provider) stopEditing();
        $toast.success(t('ProviderKeys.cleared_toast', { name }), { position: 'top-right' });
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        busy.value = false;
    }
};

onMounted(load);
</script>

<style scoped>
.rp__card { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; max-width: 900px; }
.rp__head { display: flex; align-items: center; gap: 8px; }
.rp__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); flex: 1; }
.rp__lead { margin: 0; color: var(--ink-2); }
.rp__banner { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; font: var(--text-small); }
.rp__banner--warn { background: var(--warn-bg); color: var(--warn-ink); }
.rp__field { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; gap: 6px 16px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--hairline); }
.rp__label { font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.rp__help { font: var(--text-small); color: var(--ink-2); }
.rp__control { display: grid; grid-template-columns: auto minmax(180px, 1fr); align-items: center; gap: 8px 10px; max-width: 520px; }
.rp__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rp__keys-actions { display: flex; gap: 8px; align-items: center; }
.rp__keys-form { display: flex; flex-direction: column; gap: 6px; max-width: 520px; margin-top: 4px; }
@media (max-width: 720px) { .rp__field { grid-template-columns: 1fr; } }
</style>
