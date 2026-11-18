import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { api, toast } = vi.hoisted(() => ({
    api: { apiRequest: vi.fn() },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/services', () => api);
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ id: 'user-1', Employee_Name: 'Asha Rao' }) }) }));

import PublicShareModal from '@/components/molecules/PublicShare/PublicShareModal.vue';

const PROJECT = { _id: 'pr1', sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } } };
const SHARE = { _id: 'sh1', token: 'tok', enabled: true, allowIntake: true, hasPassword: true, expiresAt: '2026-12-01T00:00:00.000Z' };
const INTAKE = [{ _id: 'i1', title: 'Fix the gate', description: 'It sticks', name: '', email: 'pat@example.com' }];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sfc = fs.readFileSync(path.resolve(HERE, '../../src/components/molecules/PublicShare/PublicShareModal.vue'), 'utf8');
const template = sfc.slice(sfc.indexOf('<template>'), sfc.lastIndexOf('</template>'));
const script = sfc.slice(sfc.indexOf('<script setup>'), sfc.indexOf('</script>'));
const style = sfc.slice(sfc.indexOf('<style'));

let wrapper;
let opener;
const dialog = () => document.body.querySelector('[role="dialog"]');
const closes = () => (wrapper.emitted('update:modelValue') || []).filter(([open]) => open === false);

async function openFromButton(projectData = PROJECT) {
    opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    wrapper = mount(PublicShareModal, {
        attachTo: document.body.appendChild(document.createElement('div')),
        props: { projectData, modelValue: false },
        global: { stubs: { ShellIcon: true, WhoCanSeeModal: true } },
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
}

beforeEach(() => { api.apiRequest.mockResolvedValue({ data: { status: true, data: null } }); });
afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
});

describe('the public link dialog', () => {
    it('is a modal dialog named by its title', async () => {
        await openFromButton();
        expect(dialog()).not.toBeNull();
        expect(dialog().getAttribute('aria-modal')).toBe('true');
        const title = document.getElementById(dialog().getAttribute('aria-labelledby'));
        expect(title.textContent.trim()).toBe('Projects.public_link');
    });

    it('closes from a labelled button', async () => {
        await openFromButton();
        const close = dialog().querySelector('.pshare__close');
        expect(close.tagName).toBe('BUTTON');
        expect(close.getAttribute('type')).toBe('button');
        expect(close.getAttribute('aria-label')).toBe('Projects.close');
        close.click();
        expect(closes()).toHaveLength(1);
    });

    it('takes focus when it opens and gives it back to the opener when it closes', async () => {
        await openFromButton();
        expect(dialog().contains(document.activeElement)).toBe(true);
        await wrapper.setProps({ modelValue: false });
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(opener);
    });

    it('closes on Escape without the key reaching the page behind it', async () => {
        await openFromButton();
        const behind = vi.fn();
        document.addEventListener('keydown', behind);
        dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        document.removeEventListener('keydown', behind);
        expect(closes()).toHaveLength(1);
        expect(behind).not.toHaveBeenCalled();
    });

    it('leaves other keys to the page', async () => {
        await openFromButton();
        const behind = vi.fn();
        document.addEventListener('keydown', behind);
        dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
        document.removeEventListener('keydown', behind);
        expect(closes()).toHaveLength(0);
        expect(behind).toHaveBeenCalledTimes(1);
    });
});

describe('the public link dialog on the design system', () => {
    it('takes every colour from a token', () => {
        expect(style.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/gi) || []).toEqual([]);
        expect(style).toMatch(/var\(--surface\)/);
    });

    it('is built from the shared card, button and input classes, with no legacy utility class', () => {
        const classes = [...template.matchAll(/\bclass="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/)).filter(Boolean);
        expect(classes).toEqual(expect.arrayContaining(['ah-card', 'ah-card__head', 'ah-card__body', 'ah-btn', 'ah-input', 'ah-check']));
        expect(classes.filter((name) => !/^(ah-|pshare)/.test(name))).toEqual([]);
        expect(template).not.toMatch(/\sstyle=|:style=/);
    });

    it('has no bare text in its template, its toasts or its fallback names', () => {
        const text = template.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[\s\S]*?\}\}/g, '').replace(/<[^>]*>/g, '');
        expect(text.replace(/\s+/g, '')).toBe('');
        expect(script).not.toMatch(/\$toast\.\w+\(\s*['"`]/);
        expect(script).not.toMatch(/\|\|\s*'[A-Z]/);
    });

    it('fits a phone: the card is bounded by the viewport and its rows wrap', () => {
        expect(style).toMatch(/\.pshare__card\s*\{[^}]*max-width:\s*100%/);
        expect(style).toMatch(/\.pshare__linkrow\s*\{[^}]*flex-wrap:\s*wrap/);
    });
});

describe('the public link dialog, with a link', () => {
    const answers = (method, url) => {
        if (method === 'delete') return { data: { status: true } };
        if (String(url).includes('/intake')) return { data: { status: true, data: INTAKE } };
        return { data: { status: true, data: SHARE } };
    };
    beforeEach(() => { api.apiRequest.mockImplementation(async (method, url) => answers(method, url)); });

    it('shows the link, its switches, its facts and the requests waiting', async () => {
        await openFromButton();
        expect(dialog().querySelector('.pshare__link').value).toBe(`${window.location.origin}/share/tok`);
        expect([...dialog().querySelectorAll('input.ah-check')].map((box) => box.checked)).toEqual([true, true]);
        expect(dialog().querySelector('.pshare__meta').textContent).toContain('Projects.password_protected');
        expect(dialog().querySelector('.pshare__meta').textContent).toContain('Projects.share_expires_on');
        expect(dialog().querySelector('.pshare__intake-row').textContent).toContain('Fix the gate');
        expect(dialog().querySelector('.pshare__intake-row').textContent).toContain('Projects.anonymous');
    });

    it('deletes the link from a real button and says so through i18n', async () => {
        await openFromButton();
        const remove = dialog().querySelector('.pshare__delete');
        expect(remove.tagName).toBe('BUTTON');
        remove.click();
        await flushPromises();
        expect(api.apiRequest).toHaveBeenCalledWith('delete', '/api/v2/public-shares/sh1');
        expect(toast.success).toHaveBeenCalledWith('Projects.public_link_deleted', { position: 'top-right' });
        expect(dialog().querySelector('.pshare__link')).toBeNull();
    });

    it('accepts and rejects a request from real buttons', async () => {
        await openFromButton();
        const [accept, reject] = dialog().querySelectorAll('.pshare__intake-row button');
        accept.click();
        reject.click();
        await flushPromises();
        expect(api.apiRequest).toHaveBeenCalledWith('post', '/api/v2/intake/review', { intakeId: 'i1', action: 'accept' });
        expect(api.apiRequest).toHaveBeenCalledWith('post', '/api/v2/intake/review', { intakeId: 'i1', action: 'reject' });
    });

    it('names a list that has no name from the locale', async () => {
        await openFromButton({ _id: 'pr1', sprintsObj: { s1: { id: 's1' } } });
        expect(dialog().querySelector('select option').textContent.trim()).toBe('Projects.sprint');
    });
});
