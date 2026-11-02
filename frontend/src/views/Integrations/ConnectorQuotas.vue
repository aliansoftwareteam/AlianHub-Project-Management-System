<template>
    <section v-if="privileged" class="ah-card cq" data-test="connector-quotas" aria-labelledby="connector-quotas-title">
        <div id="connector-quotas-title" class="cq__title">{{ $t('Connectors.quota.title') }}</div>
        <p class="ah-small cq__lead">{{ $t('Connectors.quota.lead') }}</p>

        <div v-if="loadError" class="ah-field__error" data-test="quota-load-error">{{ loadError }}</div>
        <div v-else-if="!overview" class="ah-small">{{ $t('Connectors.quota.loading') }}</div>
        <template v-else>
            <form class="cq__form" data-test="quota-form" novalidate @submit.prevent="save">
                <div class="cq__who">
                    <label class="cq__field">
                        <span class="ah-field__label">{{ $t('Connectors.quota.scope_label') }}</span>
                        <select v-model="scope" class="ah-input" data-test="quota-scope" @change="targetId = ''">
                            <option v-for="name in SCOPES" :key="name" :value="name">{{ $t(`Connectors.quota.scope_${name}`) }}</option>
                        </select>
                    </label>
                    <label v-if="scope !== WORKSPACE" class="cq__field">
                        <span class="ah-field__label">{{ $t(`Connectors.quota.pick_${scope}`) }}</span>
                        <select v-model="targetId" class="ah-input" data-test="quota-target">
                            <option value="" disabled>{{ $t(`Connectors.quota.pick_${scope}`) }}</option>
                            <option v-for="option in targets" :key="option.id" :value="option.id">{{ option.name }}</option>
                        </select>
                    </label>
                </div>

                <div v-if="scope === WORKSPACE || targetId" class="cq__limits">
                    <label v-for="field in fields" :key="field" class="cq__field">
                        <span class="ah-field__label">{{ $t(`Connectors.quota.${field}`) }}</span>
                        <input
                            v-model="draft[field]"
                            class="ah-input"
                            type="number"
                            min="0"
                            step="1"
                            :placeholder="String(fallbackOf(field))"
                            :aria-invalid="problems[field] ? 'true' : 'false'"
                            :data-test="`quota-${field}`"
                            @input="onType(field, $event.target)"
                        />
                        <span class="ah-small cq__hint">{{ $t('Connectors.quota.blank_uses', { n: fallbackOf(field) }) }} {{ $t('Connectors.quota.ceiling', { n: overview.ceilings[field] }) }}</span>
                        <span v-if="heldBelowSaved(field)" class="ah-small cq__held" :data-test="`quota-${field}-held`">{{ $t('Connectors.quota.held_at', { saved: savedLimits[field], n: overview.ceilings[field] }) }}</span>
                        <span v-if="problems[field]" class="ah-field__error" role="alert" :data-test="`quota-${field}-error`">{{ problems[field] }}</span>
                    </label>
                </div>

                <div v-if="saveError" class="ah-field__error" role="alert" data-test="quota-save-error">{{ saveError }}</div>
                <div class="cq__actions">
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !changedFields.length" data-test="quota-save">{{ busy ? $t('Connectors.quota.saving') : $t('Connectors.quota.save') }}</button>
                    <span v-if="saved" class="ah-small cq__hint" role="status" data-test="quota-saved">{{ $t('Connectors.quota.saved') }}</span>
                </div>
            </form>

            <div v-if="overrides.length" class="cq__overrides" data-test="quota-overrides">
                <div class="cq__label">{{ $t('Connectors.quota.overrides_title') }}</div>
                <div v-for="row in overrides" :key="`${row.scope}:${row.targetId}`" class="cq__override" data-test="quota-override">
                    <span class="cq__name">{{ row.name }}</span>
                    <span class="ah-small cq__hint">{{ row.line }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="quota-override-change" @click="open(row)">{{ $t('Connectors.quota.change') }}</button>
                </div>
            </div>
        </template>
    </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { isOwnerOrAdmin } from '@/utils/roles';
import { membersOnly } from '@/views/Workflows/approvalOwners';

defineOptions({ name: 'ConnectorQuotas' });

const WORKSPACE = 'workspace';
const MEMBER = 'member';
const AGENT = 'agent';
const SCOPES = [WORKSPACE, MEMBER, AGENT];
const FIELDS_OF = { [WORKSPACE]: ['reads', 'writeProposals', 'agentReads'], [MEMBER]: ['reads', 'writeProposals'], [AGENT]: ['agentReads'] };
const BASE = `${env.CONNECTORS}/admin/quotas`;

const { t } = useI18n();
const { getters } = useStore();

const overview = ref(null);
const agents = ref([]);
const agentsFailed = ref(false);
const loadError = ref('');
const saveError = ref('');
const saved = ref(false);
const busy = ref(false);
const scope = ref(WORKSPACE);
const targetId = ref('');
const draft = reactive({ reads: '', writeProposals: '', agentReads: '' });
const problems = reactive({ reads: '', writeProposals: '', agentReads: '' });
const unreadable = reactive({ reads: false, writeProposals: false, agentReads: false });

const privileged = computed(() => isOwnerOrAdmin(Number(getters['settings/companyUserDetail']?.roleType)));
const members = computed(() => membersOnly(getters['users/users'], getters['settings/companyUsers']).map((user) => ({ id: String(user._id), name: user.Employee_Name })));
const targets = computed(() => {
    const listed = scope.value === MEMBER ? members.value : agents.value;
    // Someone who has gone is no longer listed, and their saved limit still has to open here to be taken away.
    const gone = targetId.value && !listed.some((option) => option.id === targetId.value);
    return gone ? [...listed, { id: targetId.value, name: t(`Connectors.quota.unknown_${scope.value}`) }] : listed;
});
const fields = computed(() => FIELDS_OF[scope.value]);

const rowsOf = (name) => (name === MEMBER ? overview.value.members : overview.value.agents);
const savedLimits = computed(() => {
    if (!overview.value) return {};
    if (scope.value === WORKSPACE) return overview.value.workspace;
    return (rowsOf(scope.value).find((row) => row.targetId === targetId.value) || {}).limits || {};
});
const present = (value) => value !== null && value !== undefined;
const workspaceOr = (field) => (present(overview.value.workspace[field]) ? overview.value.workspace[field] : overview.value.defaults[field]);
const fallbackOf = (field) => Math.min(scope.value === WORKSPACE ? overview.value.defaults[field] : workspaceOr(field), overview.value.ceilings[field]);

const typed = (field) => String(draft[field] ?? '').trim();
const savedText = (field) => (present(savedLimits.value[field]) ? String(savedLimits.value[field]) : '');
const changedFields = computed(() => {
    if (scope.value !== WORKSPACE && !targetId.value) return [];
    return fields.value.filter((field) => unreadable[field] || typed(field) !== savedText(field));
});
const heldBelowSaved = (field) => present(savedLimits.value[field]) && savedLimits.value[field] > overview.value.ceilings[field];

// A number input reads as empty while it holds what is no number, and an empty field takes the limit away.
const onType = (field, input) => {
    problems[field] = '';
    saved.value = false;
    unreadable[field] = Boolean(input.validity && input.validity.badInput);
};

const fillDraft = () => {
    Object.keys(draft).forEach((field) => { draft[field] = savedText(field); problems[field] = ''; unreadable[field] = false; });
    saveError.value = '';
};
watch([scope, targetId, overview], fillDraft);
watch([scope, targetId], () => { saved.value = false; });

const nameOf = (name, id) => {
    const found = (name === MEMBER ? members.value : agents.value).find((option) => option.id === id);
    if (found) return found.name;
    // A list that failed to load says nothing about whether the agent still exists.
    return t(name === AGENT && agentsFailed.value ? 'Connectors.quota.agent_unread' : `Connectors.quota.unknown_${name}`);
};
const lineOf = (limits) => Object.entries(limits).filter(([, n]) => present(n)).map(([field, n]) => t('Connectors.quota.override_line', { what: t(`Connectors.quota.${field}`), n: Math.min(n, overview.value.ceilings[field]) })).join(' · ');
const overrides = computed(() => (overview.value ? [MEMBER, AGENT].flatMap((name) => rowsOf(name).map((row) => ({
    scope: name, targetId: row.targetId, name: nameOf(name, row.targetId), line: lineOf(row.limits),
}))) : []));
const open = (row) => { scope.value = row.scope; targetId.value = row.targetId; };

const problemOf = (e) => e?.response?.data?.statusText || t('Connectors.quota.failed');
const answered = (res) => {
    if (res?.data?.status !== true) throw Object.assign(new Error('refused'), { response: res });
    return res.data.data;
};

/* Said on the screen before anything is sent; the server holds the same two rules for any other caller. */
const refusalOf = (field) => {
    const n = Number(typed(field));
    const what = t(`Connectors.quota.${field}`);
    if (unreadable[field] || !Number.isInteger(n) || n < 0) return t('Connectors.quota.not_whole', { what });
    return n > overview.value.ceilings[field] ? t('Connectors.quota.over_ceiling', { what, n: overview.value.ceilings[field] }) : '';
};

const save = async () => {
    const asked = changedFields.value;
    saved.value = false;
    saveError.value = '';
    asked.forEach((field) => { problems[field] = typed(field) || unreadable[field] ? refusalOf(field) : ''; });
    if (asked.some((field) => problems[field])) return;
    busy.value = true;
    try {
        // A blank field takes the override away, so the wider limit or the default applies again.
        const limits = Object.fromEntries(asked.map((field) => [field, typed(field) ? Number(typed(field)) : null]));
        answered(await apiRequest('put', BASE, { scope: scope.value, ...(scope.value === WORKSPACE ? {} : { targetId: targetId.value }), ...limits }));
        saved.value = true;
        overview.value = answered(await apiRequest('get', BASE));
    } catch (e) {
        saveError.value = problemOf(e);
    } finally {
        busy.value = false;
    }
};

const load = async () => {
    try {
        const [limits, listed] = await Promise.all([apiRequest('get', BASE), apiRequest('get', env.AGENTS).catch(() => null)]);
        agentsFailed.value = !listed?.data?.status;
        agents.value = (listed?.data?.data || []).map((agent) => ({ id: String(agent._id), name: agent.name }));
        overview.value = answered(limits);
    } catch (e) {
        loadError.value = problemOf(e);
    }
};

// After a page reload the seat arrives once the screen is up, so the limits are read when it does.
watch(privileged, (isPrivileged) => { if (isPrivileged && !overview.value) load(); }, { immediate: true });
</script>

<style scoped>
.cq { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; max-width: 900px; margin-bottom: 14px; background: var(--surface); }
.cq__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.cq__lead { margin: 0; color: var(--ink-2); }
.cq__form { display: flex; flex-direction: column; gap: 12px; }
.cq__who, .cq__limits { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px 14px; align-items: start; }
.cq__field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cq__hint { color: var(--ink-2); }
.cq__held { color: var(--ink); }
.cq__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cq__overrides { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--hairline); }
.cq__label { font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.cq__override { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 28px; padding: 4px 0; border-bottom: 1px solid var(--hairline); }
.cq__name { flex: 0 1 200px; min-width: 0; overflow-wrap: anywhere; color: var(--ink); }
.cq__override .ah-btn { margin-left: auto; }
</style>
