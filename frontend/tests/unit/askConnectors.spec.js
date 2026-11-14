import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import * as env from '@/config/env';
import { connectorsOf, connectorResults, contextPayload, groupMentions, namedConnectors, withNamedChips, connectorNoteKey } from '@/views/Ai/askComposer';
import { useAskComposer } from '@/views/Ai/useAskComposer';
import AskComposerMenu from '@/views/Ai/AskComposerMenu.vue';
import AskConnectorNotes from '@/views/Ai/AskConnectorNotes.vue';

const LABELS = { github: 'GitHub', notion: 'Notion', fake: 'Fake' };
const label = (id) => LABELS[id] || id;
const LIST = {
    providers: [{ provider: 'notion', products: ['workspace'] }, { provider: 'github', products: ['repos'] }, { provider: 'fake', products: ['notes'] }],
    connections: [
        { provider: 'notion', connected: false },
        { provider: 'github', connected: true, status: 'connected' },
        { provider: 'fake', connected: true, status: 'broken' }
    ]
};
const APPS = connectorsOf(LIST, label);

const LinkStub = defineComponent({ name: 'RouterLink', props: { to: { type: [Object, String], required: true } }, setup: (props, { slots }) => () => h('a', { 'data-to': JSON.stringify(props.to) }, slots.default && slots.default()) });

describe('the connectors an asker can name', () => {
    it('reads the connectors list into apps, each with whether the asker holds a connection', () => {
        expect(APPS).toEqual([
            { id: 'notion', name: 'Notion', connected: false },
            { id: 'github', name: 'GitHub', connected: true },
            { id: 'fake', name: 'Fake', connected: true }
        ]);
        expect(connectorsOf(null)).toEqual([]);
    });

    it('offers connected apps first, then the ones to connect, leaving out a chip already added', () => {
        expect(connectorResults(APPS, '').map((item) => [item.id, item.connected])).toEqual([['github', true], ['fake', true], ['notion', false]]);
        expect(connectorResults(APPS, 'no')).toEqual([{ kind: 'connector', id: 'notion', title: 'Notion', connected: false }]);
        expect(connectorResults(APPS, '', [{ kind: 'connector', id: 'github' }]).map((item) => item.id)).toEqual(['fake', 'notion']);
    });
});

describe('typing an app\'s name', () => {
    it('names a connected app only as a whole word, in any case', () => {
        expect(namedConnectors("what's the status of PR 482 on GitHub?", APPS)).toEqual(['github']);
        expect(namedConnectors('ask github and FAKE', APPS)).toEqual(['github', 'fake']);
        expect(namedConnectors("GitHub's checks", APPS)).toEqual(['github']);
        expect(namedConnectors('the githubber fakery', APPS)).toEqual([]);
    });

    it('adds nothing for an app the asker has not connected', () => {
        expect(namedConnectors('what changed on my Notion roadmap page?', APPS)).toEqual([]);
    });

    it('names GitHub by a pull request it owns', () => {
        expect(namedConnectors('status of https://github.com/acme/web/pull/482', APPS)).toEqual(['github']);
        expect(namedConnectors('is acme/web#482 merged', APPS)).toEqual(['github']);
        expect(namedConnectors('see step #3 of the plan', [{ id: 'github', name: 'Hub', connected: true }])).toEqual([]);
        expect(namedConnectors('is acme/web#482 merged', [{ id: 'github', name: 'GitHub', connected: false }])).toEqual([]);
    });

    it('adds a chip while the name is typed, drops it once the name is cut, and keeps one the asker removed out', () => {
        const added = withNamedChips([], 'ask GitHub', APPS);
        expect(added).toEqual([{ kind: 'connector', id: 'github', title: 'GitHub', auto: true }]);
        expect(withNamedChips(added, 'ask', APPS)).toEqual([]);
        expect(withNamedChips([], 'ask GitHub', APPS, ['github'])).toEqual([]);
        const picked = [{ kind: 'connector', id: 'github', title: 'GitHub' }];
        expect(withNamedChips(picked, 'ask', APPS)).toEqual(picked);
    });
});

describe('the composer', () => {
    const composerWith = async (onConnect = vi.fn()) => {
        const question = ref('');
        const box = ref(null);
        const composer = useAskComposer({ question, box, skills: ref([]), label, onConnect });
        await composer.loadConnectors();
        const type = (text) => {
            question.value = text;
            box.value = { value: text, selectionStart: text.length, focus: () => {}, setSelectionRange: () => {} };
            composer.onInput();
        };
        return { composer, question, type, onConnect };
    };

    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockImplementation((type, url) => (type === 'get' && url === env.CONNECTORS
            ? Promise.resolve({ data: { status: true, data: LIST } })
            : Promise.resolve({ data: { status: true, data: {} } })));
    });

    it('sends a named app as a connector chip, and nothing once the asker removed it', async () => {
        const { composer, type } = await composerWith();
        type('@GitHub what is the status of PR 482 in acme/web ');
        expect(composer.body()).toEqual({ context: [{ kind: 'connector', id: 'github' }] });
        composer.removeChip(composer.chips.value[0]);
        type('@GitHub what is the status of PR 482 in acme/web ?');
        expect(composer.body()).toEqual({});
        composer.reset();
        type('GitHub again');
        expect(composer.body()).toEqual({ context: [{ kind: 'connector', id: 'github' }] });
    });

    it('offers apps under @ and sends a picked one as a chip', async () => {
        const { composer, type, question } = await composerWith();
        type('status @Gi');
        expect(composer.menu.items).toEqual([{ kind: 'connector', id: 'github', title: 'GitHub', connected: true }]);
        expect(composer.chips.value).toEqual([]);
        composer.pick(composer.menu.items[0]);
        expect(question.value).toBe('status GitHub ');
        expect(composer.body()).toEqual({ context: [{ kind: 'connector', id: 'github' }] });
    });

    it('sends an app the asker has not connected to connect it, and adds no chip', async () => {
        const { composer, type, onConnect } = await composerWith();
        type('@No');
        composer.pick(composer.menu.items.find((item) => item.id === 'notion'));
        expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'notion', connected: false }));
        expect(composer.chips.value).toEqual([]);
    });

    it('works without connectors where the route is not there', async () => {
        apiRequest.mockImplementation(() => Promise.reject(new Error('404')));
        const { composer, type } = await composerWith();
        type('GitHub');
        expect(composer.connectors.value).toEqual([]);
        expect(composer.body()).toEqual({});
    });
});

describe('the @ menu', () => {
    it('puts apps first in a group of their own and keeps their chips in what is sent', () => {
        const apps = connectorResults(APPS, '');
        const { items, groups } = groupMentions([{ kind: 'task', id: 't1', title: 'Fix login' }], { apps });
        expect(groups.map((group) => group.kind)).toEqual(['connector', 'task']);
        expect(groups[1].items[0].index).toBe(apps.length);
        expect(items[apps.length]).toMatchObject({ kind: 'task', id: 't1' });
        expect(contextPayload([{ kind: 'connector', id: 'github', title: 'GitHub' }, { kind: 'task', id: 't1' }])).toEqual([{ kind: 'connector', id: 'github' }, { kind: 'task', id: 't1' }]);
    });

    it('labels an app and offers Connect for one the asker has not connected', () => {
        const { items, groups } = groupMentions([], { apps: connectorResults(APPS, '') });
        const wrapper = mount(AskComposerMenu, { props: { id: 'm', kind: 'mention', items, groups } });
        const rows = wrapper.findAll('[data-test="ask-menu-item"]');
        expect(rows.map((row) => row.attributes('data-kind'))).toEqual(['connector', 'connector', 'connector']);
        expect(wrapper.find('[data-test="ask-menu-group"]').text()).toContain('Ask.group_apps');
        expect(rows.map((row) => row.find('[data-test="ask-menu-connect"]').exists())).toEqual([false, false, true]);
    });
});

describe('what the answer says about the apps', () => {
    it('says a change waits in the Inbox and what to connect, in the asker\'s words, and keeps the server\'s for others', async () => {
        const wrapper = mount(AskConnectorNotes, {
            props: {
                connectors: {
                    proposals: [{ proposalId: 'p1', provider: 'github', app: 'GitHub' }],
                    notes: [
                        { provider: 'github', app: 'GitHub', code: 'not_connected', text: 'Connect GitHub on Connectors first, then ask again.' },
                        { provider: 'fake', app: 'Fake', code: 'quota_reached', text: 'This person used today\'s 500 reads from connected apps.' }
                    ]
                }
            },
            global: { stubs: { RouterLink: LinkStub } }
        });
        await flushPromises();
        expect(wrapper.find('[data-test="ask-app-waiting"]').text()).toContain('Ask.connector_waiting');
        const notes = wrapper.findAll('[data-test="ask-app-note"]');
        expect(notes[0].text()).toContain('Ask.connector_not_connected');
        expect(JSON.parse(notes[0].find('a').attributes('data-to'))).toMatchObject({ name: 'Connections' });
        expect(notes[1].text()).toContain('500 reads');
        expect(notes[1].find('a').exists()).toBe(false);
        expect(connectorNoteKey('constructor')).toBe('');
    });
});
