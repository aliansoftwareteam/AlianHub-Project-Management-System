import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import SlackConnector from '@/views/Integrations/SlackConnector.vue';
import SlackPostPreview from '@/views/Ai/SlackPostPreview.vue';
import { taintSourcesLine } from '@/views/Ai/taintText';
import { skillLabel, skillAbout } from '@/views/Ai/plainLabels';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const BASE = '/api/v2/connectors/slack';
// Assembled here so no token-shaped literal sits in the repository; it is not a real token.
const TOKEN = ['xoxb', '0123456789', 'abcdefghijklmnopqrstuvwx'].join('-');
const SET_AT = '2026-10-01T09:00:00.000Z';
const RELEASES = { id: 'C0RELEASES1', name: 'releases', member: true };
const GENERAL = { id: 'C0GENERAL01', name: 'general', member: false };

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const connection = (over = {}) => ({
    on: true, problems: [], connected: true, status: 'connected', brokenReason: '', brokenAt: null, team: { id: 'T1', name: 'Acme' },
    secrets: { bot_token: { set: true, setAt: SET_AT }, signing_secret: { set: false, setAt: null } },
    channels: [GENERAL, RELEASES], channelsFetchedAt: SET_AT, allowedChannels: [{ id: RELEASES.id, name: RELEASES.name }], lastPostAt: null,
    ...over,
});
const empty = () => connection({ connected: false, status: null, team: null, secrets: { bot_token: { set: false, setAt: null }, signing_secret: { set: false, setAt: null } }, channels: [], allowedChannels: [] });

const serve = (state, { refuse } = {}) => {
    apiRequest.mockImplementation((method, url) => {
        if (refuse && method !== 'get') return Promise.reject({ response: { data: { status: false, statusText: refuse } } });
        if (url.startsWith(BASE)) return Promise.resolve({ data: { status: true, data: state } });
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
};

const open = async ({ roleType = 1, conn = connection(), refuse } = {}) => {
    serve(conn, { refuse });
    const wrapper = mount(SlackConnector, { global: { plugins: [storeFor(roleType)], mocks: { $t: t } } });
    await flushPromises();
    return wrapper;
};

const callsTo = (method) => apiRequest.mock.calls.filter(([m]) => m === method);

beforeEach(() => {
    apiRequest.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the Slack connector section', () => {
    it('shows each secret as set with its date, or not set, and never a value', async () => {
        const wrapper = await open();
        expect(wrapper.find('[data-test="slack-secret-bot_token"] [data-test="secret-state"]').text()).toBe(t('SlackConnector.set_on', { when: new Date(SET_AT).toLocaleString() }));
        expect(wrapper.find('[data-test="slack-secret-signing_secret"] [data-test="secret-state"]').text()).toBe(t('SlackConnector.not_set'));
        expect(wrapper.find('[data-test="slack-secret-bot_token"] [data-test="secret-set"]').text()).toBe(t('SlackConnector.replace'));
        expect(wrapper.find('[data-test="slack-secret-bot_token"] [data-test="secret-remove"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="slack-secret-signing_secret"] [data-test="secret-remove"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="slack-team"]').text()).toContain('Acme');
        expect(wrapper.html()).not.toContain('xoxb-');
    });

    it('sends a new bot token once, clears the field, and shows what the server answered', async () => {
        const wrapper = await open({ conn: empty() });
        expect(wrapper.find('[data-test="slack-channels"]').exists()).toBe(false);
        await wrapper.find('[data-test="slack-secret-bot_token"] [data-test="secret-set"]').trigger('click');
        const input = wrapper.find('[data-test="secret-input"]');
        expect(input.attributes('type')).toBe('password');
        await input.setValue(`  ${TOKEN}  `);
        serve(connection());
        await wrapper.find('[data-test="secret-form"]').trigger('submit');
        await flushPromises();
        expect(callsTo('put')).toEqual([['put', `${BASE}/secrets`, { botToken: TOKEN }]]);
        expect(wrapper.find('[data-test="secret-form"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="slack-channels"]').exists()).toBe(true);
        expect(wrapper.html()).not.toContain(TOKEN);
    });

    it('keeps the form open with Slack\'s refusal and still clears the typed value', async () => {
        const wrapper = await open({ conn: empty(), refuse: 'Slack did not accept this token (invalid_auth).' });
        await wrapper.find('[data-test="slack-secret-bot_token"] [data-test="secret-set"]').trigger('click');
        await wrapper.find('[data-test="secret-input"]').setValue(TOKEN);
        await wrapper.find('[data-test="secret-form"]').trigger('submit');
        await flushPromises();
        expect(wrapper.find('[data-test="secret-error"]').text()).toBe('Slack did not accept this token (invalid_auth).');
        expect(wrapper.find('[data-test="secret-input"]').element.value).toBe('');
    });

    it('sends nothing for an empty value', async () => {
        const wrapper = await open({ conn: empty() });
        await wrapper.find('[data-test="slack-secret-signing_secret"] [data-test="secret-set"]').trigger('click');
        await wrapper.find('[data-test="secret-form"]').trigger('submit');
        expect(wrapper.find('[data-test="secret-error"]').text()).toBe(t('SlackConnector.err_value'));
        expect(callsTo('put')).toEqual([]);
    });

    it('removes a secret only after the person confirms', async () => {
        const wrapper = await open();
        window.confirm.mockReturnValueOnce(false);
        await wrapper.find('[data-test="slack-secret-bot_token"] [data-test="secret-remove"]').trigger('click');
        expect(callsTo('delete')).toEqual([]);
        await wrapper.find('[data-test="slack-secret-bot_token"] [data-test="secret-remove"]').trigger('click');
        await flushPromises();
        expect(callsTo('delete')).toEqual([['delete', `${BASE}/secrets/bot_token`]]);
    });

    const ticks = (wrapper, id) => ['read', 'post'].map((use) => wrapper.find(`[data-test="slack-channel-${id}"] [data-test="tick-${use}"]`));
    const state = (wrapper, id) => ticks(wrapper, id).map((box) => box.element.checked);

    it('shows two ticks for each channel Slack listed, read and post, as the server holds them', async () => {
        const wrapper = await open({ conn: connection({ allowedChannels: [{ id: RELEASES.id, name: RELEASES.name, read: true, post: false }] }) });
        expect(state(wrapper, GENERAL.id)).toEqual([false, false]);
        expect(state(wrapper, RELEASES.id)).toEqual([true, false]);
        expect(ticks(wrapper, RELEASES.id).map((box) => box.attributes('aria-label'))).toEqual([t('SlackConnector.read_label', { name: 'releases' }), t('SlackConnector.post_label', { name: 'releases' })]);
        expect(wrapper.find(`[data-test="slack-channel-${GENERAL.id}"]`).text()).toContain(t('SlackConnector.not_member'));
        expect(wrapper.find('[data-test="slack-channels"]').text()).toContain(t('SlackConnector.read_lead'));
        expect(wrapper.find('[data-test="channels-save"]').attributes('disabled')).toBeDefined();
    });

    it('a channel allowed before reading existed shows as post only', async () => {
        const wrapper = await open();
        expect(state(wrapper, RELEASES.id)).toEqual([false, true]);
        expect(wrapper.find('[data-test="channels-save"]').attributes('disabled')).toBeDefined();
    });

    it('saves each channel with its two ticks, and leaves out a channel with neither', async () => {
        const wrapper = await open();
        await ticks(wrapper, RELEASES.id)[0].setValue(true);
        await ticks(wrapper, GENERAL.id)[0].setValue(true);
        await ticks(wrapper, GENERAL.id)[0].setValue(false);
        expect(wrapper.find('[data-test="channels-save"]').attributes('disabled')).toBeUndefined();
        await wrapper.find('[data-test="channels-save"]').trigger('click');
        await flushPromises();
        expect(callsTo('put')).toEqual([['put', `${BASE}/channels`, { channels: [{ id: RELEASES.id, read: true, post: true }] }]]);
    });

    it('unticking both removes the channel from the list that is saved', async () => {
        const wrapper = await open();
        await ticks(wrapper, RELEASES.id)[1].setValue(false);
        await ticks(wrapper, GENERAL.id)[1].setValue(true);
        await wrapper.find('[data-test="channels-save"]').trigger('click');
        await flushPromises();
        expect(callsTo('put')[0][2]).toEqual({ channels: [{ id: GENERAL.id, read: false, post: true }] });
    });

    it('reads the channel list again on request', async () => {
        const wrapper = await open();
        await wrapper.find('[data-test="channels-refresh"]').trigger('click');
        await flushPromises();
        expect(callsTo('post')).toEqual([['post', `${BASE}/channels/refresh`]]);
    });

    it('tells the admin when Slack no longer accepts the token', async () => {
        const wrapper = await open({ conn: connection({ status: 'broken', brokenReason: 'invalid_auth', brokenAt: SET_AT }) });
        expect(wrapper.find('[data-test="slack-broken"]').text()).toBe(t('SlackConnector.broken', { reason: 'invalid_auth', when: new Date(SET_AT).toLocaleString() }));
    });

    it('says a revoked secret has to be set again', async () => {
        const wrapper = await open({ conn: connection({ connected: false, status: null, secrets: { bot_token: { set: false, setAt: null, revoked: true }, signing_secret: { set: false, setAt: null } } }) });
        expect(wrapper.find('[data-test="slack-secret-bot_token"] [data-test="secret-state"]').text()).toBe(t('SlackConnector.revoked'));
    });

    it('explains why the connector stays off, and offers nothing to set', async () => {
        const wrapper = await open({ conn: { on: false, problems: ['secrets_store_off', 'taint_routing_off'] } });
        const off = wrapper.find('[data-test="slack-off"]');
        expect(off.text()).toContain(t('SlackConnector.off_title'));
        expect(off.findAll('li').map((li) => li.text())).toEqual([t('SlackConnector.problem_secrets_store_off'), t('SlackConnector.problem_taint_routing_off')]);
        expect(wrapper.find('[data-test="slack-secret-bot_token"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="slack-channels"]').exists()).toBe(false);
    });

    it('shows the server\'s reason when the section cannot be loaded', async () => {
        apiRequest.mockRejectedValue({ response: { data: { status: false, statusText: 'Only an owner or admin can manage connectors.' } } });
        const wrapper = mount(SlackConnector, { global: { plugins: [storeFor(1)], mocks: { $t: t } } });
        await flushPromises();
        expect(wrapper.find('[data-test="slack-load-error"]').text()).toBe('Only an owner or admin can manage connectors.');
    });

    it.each([3, 0])('shows a member or guest (role %s) nothing and asks the server for nothing', async (roleType) => {
        const wrapper = await open({ roleType });
        expect(wrapper.find('[data-test="slack-connector"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('the Slack message on an approval card', () => {
    const change = { action: 'slack.message.post', label: 'Post to #releases in Slack', params: { channelId: RELEASES.id, channelName: 'releases', text: 'Version 14.36 is out.\n  Thanks <b>all</b>.' } };
    const show = (delivery) => mount(SlackPostPreview, { props: { change, delivery }, global: { mocks: { $t: t } } });

    it('shows the channel name, its id and the text exactly as stored', () => {
        const wrapper = show(null);
        expect(wrapper.find('[data-test="slack-post-channel"]').text()).toBe(`#releases ${RELEASES.id}`);
        expect(wrapper.find('[data-test="slack-post-text"]').element.textContent).toBe(change.params.text);
        expect(wrapper.find('[data-test="slack-post-text"]').find('b').exists()).toBe(false);
        expect(wrapper.text()).toContain(t('Ai.slack_post_note'));
        expect(wrapper.find('[data-test="slack-post-result"]').exists()).toBe(false);
    });

    it('shows the message timestamp once posted, or the error when it was not', () => {
        expect(show({ ok: true, ts: '1727780000.000100' }).find('[data-test="slack-post-result"]').text()).toBe(t('Ai.slack_post_sent', { ts: '1727780000.000100' }));
        const failed = show({ ok: false, error: 'slack: invalid_auth' }).find('[data-test="slack-post-result"]');
        expect(failed.text()).toBe(t('Ai.slack_post_failed', { error: 'slack: invalid_auth' }));
        expect(failed.classes()).toContain('ah-field__error');
    });
});

describe('how a run that read Slack is named', () => {
    it('names the connector among the sources, and the summary skill by what it does', () => {
        expect(taintSourcesLine(t, [{ kind: 'connector', ref: 'slack:C0RELEASES1' }])).toBe(`${t('Audit.taint_kind_connector')} slack:C0RELEASES1`);
        const skill = { key: 'slack.summary', name: 'Slack summariser', source: 'code' };
        expect(skillLabel(t, skill)).toBe(t('Ai.skill_label_slack_summary'));
        expect(skillAbout(t, skill)).toBe(t('Ai.skill_about_slack_summary'));
    });
});
