import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { api } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() } }));
vi.mock('@/services', () => api);
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ id: 'user-1', Employee_Name: 'Asha Rao' }) }) }));

import PublicShareModal from '@/components/molecules/PublicShare/PublicShareModal.vue';

const PROJECT = { _id: 'pr1', sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } } };

let wrapper;
let opener;
const dialog = () => document.body.querySelector('[role="dialog"]');
const closes = () => (wrapper.emitted('update:modelValue') || []).filter(([open]) => open === false);

async function openFromButton() {
    opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    wrapper = mount(PublicShareModal, {
        attachTo: document.body.appendChild(document.createElement('div')),
        props: { projectData: PROJECT, modelValue: false },
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
