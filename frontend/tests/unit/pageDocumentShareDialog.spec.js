/* The share dialog of a doc: the switch row says what turning it on does and its state matches the doc, and
   the people list is drawn with the app's list, checkbox and avatar styles wherever the dialog opens. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';
import en from '@/locales/en';

const { api } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() } }));
const SEATS = [
    { userId: 'u-ann', roleType: 3, status: 2 },
    { userId: 'u-bob', roleType: 3, status: 2 },
];
const NAMES = { 'u-ann': 'Ann', 'u-bob': 'Bob' };

vi.mock('@/services', () => api);
vi.mock('vuex', () => ({
    useStore: () => ({
        getters: { 'settings/companyUsers': SEATS },
        commit: vi.fn(),
        dispatch: vi.fn(() => Promise.resolve()),
    }),
}));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => (NAMES[id] ? { Employee_Name: NAMES[id] } : {}) }),
    useCustomComposable: () => ({ checkPermission: () => true }),
}));

import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import PageSharePeople from '@/components/molecules/Pages/PageSharePeople.vue';

const ME = 'user-1';
const source = (path) => readFileSync(resolve(__dirname, '../../src', path), 'utf8');

let wrapper;

async function openShare(doc) {
    api.apiRequest.mockResolvedValue({ status: 200, data: { status: true, data: { _id: 'p1', title: 'Plan', content: { html: '<p>Body</p>' }, createdBy: ME, ...doc } } });
    wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' } });
    await flushPromises();
    api.apiRequest.mockResolvedValue({ data: { status: true, data: null } });
    await wrapper.findAll('.pd__actions .ah-btn--secondary').find((button) => button.text().includes('Docs.share')).trigger('click');
    await flushPromises();
}

const scopeRow = () => wrapper.get('[data-test="doc-share-scope"]');
const scopeSwitch = () => scopeRow().get('.pd__switch');

beforeEach(() => api.apiRequest.mockReset());
afterEach(() => wrapper?.unmount());

describe('the visibility row of the share dialog', () => {
    it('shows the switch off for a private doc, under a label that does not name its current state', async () => {
        await openShare({ visibility: 'private' });
        expect(scopeSwitch().classes()).not.toContain('is-on');
        expect(scopeSwitch().attributes('aria-checked')).toBe('false');
        expect(scopeRow().text()).toContain('Projects.doc_share_scope');
        expect(scopeRow().text()).toContain('Projects.doc_share_scope_off_hint');
        expect(scopeRow().text()).not.toContain('Docs.private');
    });

    it('shows the switch on for a shared doc, and never calls it Private', async () => {
        await openShare({ visibility: 'project' });
        expect(scopeSwitch().classes()).toContain('is-on');
        expect(scopeSwitch().attributes('aria-checked')).toBe('true');
        expect(scopeRow().text()).toContain('Projects.doc_share_scope');
        expect(scopeRow().text()).toContain('Projects.doc_shared_hint');
        expect(scopeRow().text()).not.toContain('Docs.private');
    });

    it('is worded by what turning it on does, in the English copy', () => {
        expect(en.Projects.doc_share_scope).not.toMatch(/private/i);
        expect(en.Projects.doc_share_scope_off_hint).toMatch(/^Off:/);
    });

    it('still turns the doc private through the same switch', async () => {
        await openShare({ visibility: 'project' });
        api.apiRequest.mockResolvedValue({ data: { status: true, data: { visibility: 'private' } } });
        await scopeSwitch().trigger('click');
        const writes = api.apiRequest.mock.calls.filter(([method, , body]) => method === 'put' && body && 'visibility' in body);
        expect(writes.map(([, , body]) => body)).toEqual([{ visibility: 'private' }]);
        expect(scopeSwitch().classes()).not.toContain('is-on');
    });

    it('keeps the switch disabled for someone who may not make the doc private', async () => {
        await openShare({ visibility: 'project', createdBy: 'user-2' });
        expect(scopeSwitch().attributes('disabled')).toBeDefined();
    });
});

describe('the people of the share dialog', () => {
    async function openPeople() {
        api.apiRequest.mockResolvedValue({ data: { status: true, data: { people: [{ userId: 'u-ann', role: 'viewer', active: true }], limit: 50 } } });
        wrapper = mount(PageSharePeople, { props: { pageId: 'doc-1' }, global: { stubs: { ShellIcon: true } } });
        await flushPromises();
        await wrapper.get('[data-test="doc-share-add"]').trigger('click');
    }

    it('draws a person with the standard avatar, in a row that is a comfortable target', async () => {
        await openPeople();
        const listed = wrapper.get('[data-test="doc-share-person"] .ah-avatar');
        const picked = wrapper.get('[data-test="glp-person"] .ah-avatar');
        expect(listed.classes()).not.toContain('ah-avatar--sm');
        expect(picked.classes()).not.toContain('ah-avatar--sm');
        expect(wrapper.get('[data-test="glp-person"] input').classes()).toContain('ah-check');
    });

    it('carries its own list styles, so it is not bulleted when the Goals stylesheet is not loaded', () => {
        const picker = source('views/Goals/GoalPeoplePicker.vue');
        expect(picker).toMatch(/<style[^>]*>[\s\S]*\.gpp__list\s*\{[^}]*list-style:\s*none/);
        expect(picker).toMatch(/\.gpp__person\s*\{[^}]*min-height:\s*max\(var\(--row-h, 40px\), 40px\)/);
        expect(source('views/Goals/style.css')).not.toMatch(/\.gpp__/);
        const people = source('components/molecules/Pages/PageSharePeople.vue');
        expect(people).toMatch(/\.psp__list\s*\{[^}]*list-style:\s*none/);
        expect(people).toMatch(/\.psp__row\s*\{[^}]*min-height:\s*max\(var\(--row-h, 40px\), 40px\)/);
    });
});
