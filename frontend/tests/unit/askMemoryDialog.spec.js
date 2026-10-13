import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params && typeof params === 'object' ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));

import * as env from '@/config/env';
import { applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import AskMemoryButton from '@/views/Ai/AskMemoryButton.vue';

const PROFILE = {
    enabled: true,
    nickname: 'Ally',
    role: 'Delivery lead',
    preferences: 'Short answers.',
    facts: [
        { id: 'f1', text: 'Runs the Ops board', source: 'manual' },
        { id: 'f2', text: 'Based in Pune', source: 'import' }
    ]
};
const LIMITS = { nickname: 60, role: 120, preferences: 1000, fact: 280, facts: 50, importText: 20000 };

const ok = (data) => Promise.resolve({ data: { status: true, data } });

let calls;
let previewItems;
const respond = (type, url, body) => {
    calls.push({ type, url, body });
    if (type === 'get' && url === env.AI_MEMORY) return ok({ profile: PROFILE, limits: LIMITS });
    if (type === 'put' && url === env.AI_MEMORY) return ok({ profile: { ...PROFILE, ...body }, stripped: 0 });
    if (type === 'delete' && url === env.AI_MEMORY) return ok({ profile: { enabled: true, nickname: '', role: '', preferences: '', facts: [] } });
    if (type === 'post' && url === env.AI_MEMORY_IMPORT_PREVIEW) return ok({ items: previewItems, stripped: 1 });
    if (type === 'post' && url === env.AI_MEMORY_IMPORT_CONFIRM) {
        const added = body.items.filter((i) => i.kind === 'fact').map((i, n) => ({ id: `n${n}`, text: i.text, source: 'import' }));
        return ok({ profile: { ...PROFILE, facts: [...PROFILE.facts, ...added] }, added: body.items.length, skipped: 0, stripped: 0 });
    }
    return ok({});
};

let wrapper;
const dialog = () => document.body.querySelector('[role="dialog"]');
const q = (sel) => document.body.querySelector(sel);
const qa = (sel) => Array.from(document.body.querySelectorAll(sel));
const setValue = async (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input'));
    await flushPromises();
};
const click = async (el) => {
    el.click();
    await flushPromises();
};

const open = async () => {
    wrapper = mount(AskMemoryButton, { attachTo: document.body, global: { mocks: { $t: echo } } });
    await wrapper.find('[data-test="ask-memory-open"]').trigger('click');
    await flushPromises();
};

const writes = () => calls.filter((c) => c.type !== 'get');

describe('Ask memory dialog', () => {
    beforeEach(() => {
        calls = [];
        previewItems = [
            { id: 'p0', kind: 'preference', text: 'Bullet points first' },
            { id: 'p1', kind: 'fact', text: 'Works in delivery' },
            { id: 'p2', kind: 'fact', text: 'Has two cats' }
        ];
        apiRequest.mockReset();
        apiRequest.mockImplementation(respond);
        resetAiAvailability();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
    });
    afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });

    it('opens a labelled modal from a button that says it opens a dialog, and loads my profile', async () => {
        wrapper = mount(AskMemoryButton, { attachTo: document.body, global: { mocks: { $t: echo } } });
        const button = wrapper.find('[data-test="ask-memory-open"]');
        expect(button.attributes('aria-haspopup')).toBe('dialog');
        expect(button.text()).toContain('AskMemory.open');
        await button.trigger('click');
        await flushPromises();

        const box = dialog();
        expect(box).not.toBeNull();
        expect(box.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(box.getAttribute('aria-labelledby'))).not.toBeNull();
        expect(apiRequest).toHaveBeenCalledWith('get', env.AI_MEMORY);
        expect(q('[data-test="memory-nickname"]').value).toBe('Ally');
        expect(q('[data-test="memory-role"]').value).toBe('Delivery lead');
        expect(q('[data-test="memory-preferences"]').value).toBe('Short answers.');
        expect(qa('[data-test="memory-fact"]')).toHaveLength(2);
        expect(q('[data-test="memory-enabled"]').getAttribute('aria-checked')).toBe('true');
    });

    it('closes on Escape and hands focus back to the button', async () => {
        await open();
        dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(wrapper.find('[data-test="ask-memory-open"]').element);
    });

    it('saves my edits, added and removed facts, and the switch in one write', async () => {
        await open();
        await setValue(q('[data-test="memory-nickname"]'), 'Al');
        await click(q('[data-test="memory-enabled"]'));
        await click(qa('[data-test="memory-fact-delete"]')[1]);
        await setValue(q('[data-test="memory-new-fact"]'), 'Prefers UK spelling');
        await click(q('[data-test="memory-add-fact"]'));
        await click(q('[data-test="memory-save"]'));

        const put = writes().find((c) => c.type === 'put');
        expect(put.url).toBe(env.AI_MEMORY);
        expect(put.body).toEqual({
            enabled: false,
            nickname: 'Al',
            role: 'Delivery lead',
            preferences: 'Short answers.',
            facts: [{ id: 'f1', text: 'Runs the Ops board' }, { id: '', text: 'Prefers UK spelling' }]
        });
    });

    it('asks before forgetting everything', async () => {
        await open();
        await click(q('[data-test="memory-forget"]'));
        expect(writes()).toEqual([]);
        await click(q('[data-test="memory-forget-confirm"]'));
        expect(writes()).toEqual([expect.objectContaining({ type: 'delete', url: env.AI_MEMORY })]);
        expect(q('[data-test="memory-nickname"]').value).toBe('');
    });

    it('copies a prompt to take to another assistant', async () => {
        await open();
        await click(q('[data-test="memory-copy-prompt"]'));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('AskMemory.import_prompt');
    });

    it('shows what it read from a paste as a checklist and saves nothing until I confirm', async () => {
        await open();
        await setValue(q('[data-test="memory-paste"]'), 'Goes by Ally. Works in delivery. Has two cats.');
        await click(q('[data-test="memory-read-paste"]'));

        expect(writes()).toEqual([expect.objectContaining({ type: 'post', url: env.AI_MEMORY_IMPORT_PREVIEW, body: { text: 'Goes by Ally. Works in delivery. Has two cats.' } })]);
        const rows = qa('[data-test="memory-preview-item"]');
        expect(rows).toHaveLength(3);
        const boxes = qa('[data-test="memory-preview-item"] input[type="checkbox"]');
        expect(boxes.every((b) => b.checked)).toBe(true);
        expect(q('[data-test="memory-preview-stripped"]')).not.toBeNull();

        boxes[2].click();
        await flushPromises();
        await click(q('[data-test="memory-preview-confirm"]'));

        const confirm = writes().find((c) => c.url === env.AI_MEMORY_IMPORT_CONFIRM);
        expect(confirm.body).toEqual({ items: [{ kind: 'preference', text: 'Bullet points first' }, { kind: 'fact', text: 'Works in delivery' }] });
        expect(qa('[data-test="memory-preview-item"]')).toHaveLength(0);
        expect(qa('[data-test="memory-fact"]')).toHaveLength(3);
    });

    it('discards a preview without writing anything', async () => {
        await open();
        await setValue(q('[data-test="memory-paste"]'), 'something');
        await click(q('[data-test="memory-read-paste"]'));
        await click(q('[data-test="memory-preview-discard"]'));
        expect(qa('[data-test="memory-preview-item"]')).toHaveLength(0);
        expect(writes().filter((c) => c.url !== env.AI_MEMORY_IMPORT_PREVIEW)).toEqual([]);
    });

    it('turns the import off while AI is off, and keeps the profile editable', async () => {
        applyAiAvailability({ state: 'off_workspace' });
        await open();
        expect(q('[data-test="memory-read-paste"]').disabled).toBe(true);
        expect(q('[data-test="memory-import-off"]')).not.toBeNull();
        expect(q('[data-test="memory-save"]').disabled).toBe(false);
    });
});
