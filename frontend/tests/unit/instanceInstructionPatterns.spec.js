import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import InstanceInstructionPatterns from '@/views/Settings/Instance/InstanceInstructionPatterns.vue';

const BASE = '/api/v2/instance/instruction-patterns';
const ADDED_ID = '6f00000000000000000000c1';
const WHEN = '2026-09-20T10:00:00.000Z';

const summary = (over = {}) => ({
    builtIn: [
        { id: 'builtin:0', source: '\\bsystem prompt\\b', locked: true },
        { id: 'builtin:1', source: '\\byou are now\\b', locked: true },
    ],
    added: [
        { id: ADDED_ID, source: '\\bwire (?:the )?funds to\\b', note: 'Supplier mail', addedBy: 'u1', addedByName: 'Olivia Owner', addedAt: WHEN, locked: false },
    ],
    history: [
        { action: 'ai.instruction_pattern_added', actorId: 'u1', actorName: 'Olivia Owner', source: '\\bwire (?:the )?funds to\\b', at: WHEN },
    ],
    cacheTtlSeconds: 30,
    limits: { maxLength: 200, maxPatterns: 100, maxRepeats: 4, maxRepeatBound: 50, matchTimeoutMs: 25 },
    ...over,
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (status, code, data) => Promise.reject({ response: { status, data: { status: false, statusText: 'Refused in English.', code, data } } });

const serve = ({ summaryData = summary(), post = () => ok({ pattern: {} }), del = () => ok({}) } = {}) => {
    apiRequestWithoutCompnay.mockImplementation((type, url, body) => {
        if (type === 'get' && url === BASE) return ok(summaryData);
        if (type === 'post' && url === BASE) return post(body);
        if (type === 'delete') return del(url);
        return Promise.reject(new Error(`unexpected ${type} ${url}`));
    });
};

const mountWith = async (options) => {
    serve(options);
    const wrapper = mount(InstanceInstructionPatterns);
    await flushPromises();
    return wrapper;
};

const calls = (type) => apiRequestWithoutCompnay.mock.calls.filter(([t]) => t === type);

describe('InstanceInstructionPatterns', () => {
    beforeEach(() => { apiRequestWithoutCompnay.mockReset(); });

    it('lists the built-in patterns with no way to remove them', async () => {
        const wrapper = await mountWith();
        const builtIn = wrapper.findAll('[data-test="builtin-pattern"]');
        expect(builtIn).toHaveLength(2);
        expect(builtIn[0].text()).toContain('\\bsystem prompt\\b');
        expect(wrapper.find('[data-test="builtin-list"]').findAll('button')).toHaveLength(0);
    });

    it('lists the added patterns with who added them and a remove button', async () => {
        const wrapper = await mountWith();
        const row = wrapper.find(`[data-test="added-${ADDED_ID}"]`);
        expect(row.text()).toContain('\\bwire (?:the )?funds to\\b');
        expect(row.text()).toContain('Supplier mail');
        expect(row.text()).toContain('Olivia Owner');
        expect(row.find(`[data-test="remove-${ADDED_ID}"]`).exists()).toBe(true);
    });

    it('says how soon a change reaches every server', async () => {
        const wrapper = await mountWith();
        expect(wrapper.find('[data-test="cache-note"]').text()).toBe('InstructionPatterns.cache_note');
    });

    it('shows an empty state when nothing is added', async () => {
        const wrapper = await mountWith({ summaryData: summary({ added: [], history: [] }) });
        expect(wrapper.find('[data-test="no-added"]').exists()).toBe(true);
    });

    it('adds a pattern with its note and reloads', async () => {
        const wrapper = await mountWith();
        await wrapper.find('input[data-test="source-input"]').setValue('  \\bsend the passcode\\b ');
        await wrapper.find('input[data-test="note-input"]').setValue('Phishing wave');
        await wrapper.find('form[data-test="add-form"]').trigger('submit');
        await flushPromises();
        expect(calls('post')).toEqual([['post', BASE, { source: '\\bsend the passcode\\b', note: 'Phishing wave' }]]);
        expect(calls('get')).toHaveLength(2);
        expect(wrapper.find('input[data-test="source-input"]').element.value).toBe('');
    });

    it('shows the translated reason when the server refuses a pattern', async () => {
        const wrapper = await mountWith({ post: () => refused(400, 'pattern_refused', { reason: 'nested_repeat' }) });
        await wrapper.find('input[data-test="source-input"]').setValue('(?:ab+)+c');
        await wrapper.find('form[data-test="add-form"]').trigger('submit');
        await flushPromises();
        const error = wrapper.find('[data-test="source-error"]');
        expect(error.exists()).toBe(true);
        expect(error.text()).toBe('InstructionPatterns.reason_nested_repeat');
    });

    it('removes an added pattern after confirmation', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const wrapper = await mountWith();
        await wrapper.find(`[data-test="remove-${ADDED_ID}"]`).trigger('click');
        await flushPromises();
        expect(calls('delete')).toEqual([['delete', `${BASE}/${ADDED_ID}`]]);
    });

    it('does not remove when the confirmation is declined', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        const wrapper = await mountWith();
        await wrapper.find(`[data-test="remove-${ADDED_ID}"]`).trigger('click');
        await flushPromises();
        expect(calls('delete')).toHaveLength(0);
    });

    it('shows the recent changes', async () => {
        const wrapper = await mountWith();
        const history = wrapper.find('[data-test="history"]');
        expect(history.text()).toContain('Olivia Owner');
    });
});
