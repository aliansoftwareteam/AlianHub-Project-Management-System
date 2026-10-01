<template>
    <section class="ah-card gcn" data-test="google-connection" aria-labelledby="google-connection-title">
        <div id="google-connection-title" class="gcn__title">{{ $t('GoogleConnection.title') }}</div>
        <p class="ah-small gcn__lead">{{ $t('GoogleConnection.lead') }}</p>

        <div v-if="notice" class="gcn__notice" :class="{ 'gcn__notice--ok': !notice.warn }" role="status" data-test="google-notice">
            <ShellIcon :name="notice.warn ? 'alert' : 'check'" :size="15" />
            <span>{{ notice.text }}</span>
        </div>

        <div v-if="loadError" class="ah-field__error" data-test="google-load-error">{{ loadError }}</div>
        <div v-else-if="!connections" class="ah-small gcn__state">{{ completing ? $t('GoogleConnection.completing') : $t('GoogleConnection.loading') }}</div>
        <template v-else>
            <div v-for="conn in connections" :key="conn.connector" class="gcn__row" :data-test="`google-${conn.connector}`">
                <div class="gcn__id">
                    <div class="gcn__label">{{ $t(`GoogleConnection.name_${conn.connector}`) }}</div>
                    <template v-if="!conn.on">
                        <div v-if="(conn.problems || []).length" class="gcn__state" data-test="google-off">
                            <div>{{ $t('GoogleConnection.off_title') }}</div>
                            <ul class="gcn__problems">
                                <li v-for="code in conn.problems" :key="code">{{ $t(`GoogleConnection.problem_${code}`) }}</li>
                            </ul>
                        </div>
                        <div v-else class="ah-small gcn__state" data-test="google-unavailable">{{ $t('GoogleConnection.off_member') }}</div>
                    </template>
                    <template v-else>
                        <div class="ah-small gcn__state" data-test="google-state">{{ stateLine(conn) }}</div>
                        <div v-if="conn.connected && conn.status === 'broken'" class="ah-small gcn__state" data-test="google-broken">
                            {{ $t('GoogleConnection.state_broken', { when: when(conn.brokenAt) }) }}
                        </div>
                        <div class="ah-small gcn__state">{{ $t(`GoogleConnection.grants_${conn.connector}`) }}</div>
                    </template>
                </div>
                <div v-if="conn.on" class="gcn__actions">
                    <button type="button" class="ah-btn ah-btn--sm" :class="conn.connected ? 'ah-btn--secondary' : 'ah-btn--primary'" :disabled="Boolean(busy)" data-test="google-connect" @click="connect(conn.connector)">
                        {{ busy === conn.connector ? $t('GoogleConnection.connecting') : conn.connected ? $t('GoogleConnection.reconnect') : $t('GoogleConnection.connect') }}
                    </button>
                    <button v-if="conn.connected" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="Boolean(busy)" data-test="google-disconnect" @click="disconnect(conn.connector)">
                        {{ $t('GoogleConnection.disconnect') }}
                    </button>
                </div>
            </div>
            <div v-if="actionError" class="ah-field__error" data-test="google-error">{{ actionError }}</div>
        </template>

        <div v-if="privileged && members" class="gcn__members" data-test="google-members">
            <div class="gcn__label">{{ $t('GoogleConnection.members_title') }}</div>
            <p class="ah-small gcn__state">{{ $t('GoogleConnection.members_lead') }}</p>
            <p v-if="!members.length" class="ah-small gcn__state" data-test="google-members-none">{{ $t('GoogleConnection.members_none') }}</p>
            <div v-for="row in members" :key="`${row.userId}-${row.connector}`" class="gcn__row" :data-test="`google-member-${row.userId}`">
                <div class="gcn__id">
                    <div class="gcn__label">{{ nameOf(row.userId) }}</div>
                    <div class="ah-small gcn__state">{{ memberLine(row) }}</div>
                </div>
                <div class="gcn__actions">
                    <button
                        type="button"
                        class="ah-btn ah-btn--ghost ah-btn--sm"
                        :disabled="Boolean(busy)"
                        :aria-label="$t('GoogleConnection.member_disconnect_label', { name: nameOf(row.userId) })"
                        data-test="google-member-disconnect"
                        @click="disconnectMember(row)"
                    >{{ $t('GoogleConnection.disconnect') }}</button>
                </div>
            </div>
            <div v-if="membersError" class="ah-field__error" data-test="google-members-error">{{ membersError }}</div>
        </div>
    </section>
</template>

<script setup>
defineOptions({ name: 'GoogleConnection' });
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { isOwnerOrAdmin } from '@/utils/roles';

const props = defineProps({
    navigate: { type: Function, default: (url) => window.location.assign(url) },
});

const { t } = useI18n();
const { getters } = useStore();
const route = useRoute();
const router = useRouter();

const BASE = `${env.CONNECTORS}/google`;
const CONNECTORS = ['google_calendar'];
const CONSENT_ADDRESS = 'https://accounts.google.com/';
const RETURN_KEYS = ['connector', 'state', 'code', 'result', 'reason'];
const RETURN_ERRORS = { access_denied: 'GoogleConnection.error_access_denied', state: 'GoogleConnection.error_state' };

const connections = ref(null);
const members = ref(null);
const loadError = ref('');
const actionError = ref('');
const membersError = ref('');
const notice = ref(null);
const busy = ref('');
const completing = ref(false);

const privileged = computed(() => isOwnerOrAdmin(Number(getters['settings/companyUserDetail']?.roleType)));
const when = (d) => (d ? new Date(d).toLocaleString() : t('GoogleConnection.never'));
const nameOf = (userId) => {
    const person = (getters['users/users'] || []).find((user) => String(user._id) === String(userId));
    return person?.Employee_Name || t('GoogleConnection.member_unknown', { id: String(userId).slice(-6) });
};
const stateLine = (conn) => {
    if (!conn.connected) return t('GoogleConnection.not_connected');
    const email = conn.account && conn.account.email;
    const who = email ? t('GoogleConnection.connected_as', { email }) : t('GoogleConnection.connected_unnamed');
    return `${who} · ${t('GoogleConnection.connected_on', { when: when(conn.connectedAt) })}`;
};

const memberLine = (row) => {
    const state = row.status === 'broken' ? t('GoogleConnection.member_broken') : t('GoogleConnection.connected_on', { when: when(row.connectedAt) });
    return `${t(`GoogleConnection.name_${row.connector}`)} · ${state}`;
};

const problemOf = (e) => e?.response?.data?.statusText || t('GoogleConnection.failed');
const answered = (res) => {
    if (res?.data?.status !== true) throw Object.assign(new Error('refused'), { response: res });
    return res.data.data || {};
};

const load = async () => {
    loadError.value = '';
    try { connections.value = answered(await apiRequest('get', `${BASE}/mine`)).connections || []; } catch (e) { loadError.value = problemOf(e); }
    if (!privileged.value) return;
    try { members.value = answered(await apiRequest('get', `${BASE}/members`)).connections || []; } catch (e) { members.value = null; }
};

/* Google sends the browser back here with the code in the address. It leaves the address before anything else
 * happens, and only this signed-in session can complete the attempt it started. */
const finishReturn = async () => {
    const query = route.query || {};
    if (!query.connector) return;
    const { connector, state, code, result, reason } = query;
    await router.replace({ query: Object.fromEntries(Object.entries(query).filter(([key]) => !RETURN_KEYS.includes(key))) });
    if (result === 'error') {
        notice.value = { warn: true, text: t(RETURN_ERRORS[reason] || 'GoogleConnection.error_generic') };
        return;
    }
    if (!CONNECTORS.includes(connector) || typeof state !== 'string' || typeof code !== 'string') return;
    completing.value = true;
    try {
        answered(await apiRequest('post', `${BASE}/${connector}/complete`, { state, code }));
        notice.value = { warn: false, text: t('GoogleConnection.connected_now') };
    } catch (e) {
        notice.value = { warn: true, text: problemOf(e) };
    } finally {
        completing.value = false;
    }
};

const connect = async (connector) => {
    busy.value = connector;
    actionError.value = '';
    try {
        const url = String(answered(await apiRequest('post', `${BASE}/${connector}/connect`)).url || '');
        if (!url.startsWith(CONSENT_ADDRESS)) throw new Error('unexpected address');
        props.navigate(url);
    } catch (e) {
        actionError.value = problemOf(e);
        busy.value = '';
    }
};

const disconnect = async (connector) => {
    if (!window.confirm(t('GoogleConnection.confirm_disconnect'))) return;
    busy.value = connector;
    actionError.value = '';
    notice.value = null;
    try {
        answered(await apiRequest('delete', `${BASE}/${connector}`));
        await load();
    } catch (e) {
        actionError.value = problemOf(e);
    } finally {
        busy.value = '';
    }
};

const disconnectMember = async (row) => {
    if (!window.confirm(t('GoogleConnection.confirm_member_disconnect', { name: nameOf(row.userId) }))) return;
    busy.value = `member-${row.userId}`;
    membersError.value = '';
    try {
        members.value = answered(await apiRequest('delete', `${BASE}/${row.connector}/members/${row.userId}`)).connections || [];
        connections.value = answered(await apiRequest('get', `${BASE}/mine`)).connections || [];
    } catch (e) {
        membersError.value = problemOf(e);
    } finally {
        busy.value = '';
    }
};

onMounted(async () => {
    await finishReturn();
    await load();
});
</script>

<style scoped>
.gcn { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; background: var(--surface); }
.gcn__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.gcn__lead { margin: 0; color: var(--ink-2); }
.gcn__notice { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--r-input); background: var(--warn-bg); color: var(--warn-ink); font: var(--text-small); }
.gcn__notice--ok { background: var(--ok-bg); color: var(--ok-ink); }
.gcn__row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 0; border-top: 1px solid var(--hairline); }
.gcn__id { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.gcn__label { font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); overflow-wrap: anywhere; }
.gcn__state { margin: 0; color: var(--ink-2); overflow-wrap: anywhere; }
.gcn__problems { margin: 6px 0 0; padding-left: 18px; }
.gcn__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.gcn__members { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--hairline); }
</style>
