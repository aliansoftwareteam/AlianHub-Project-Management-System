import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import fs from 'fs';
import path from 'path';

const { apiRequest, apiRequestWithoutCompnay, push, me } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    push: vi.fn(() => Promise.resolve()),
    me: { value: {} }
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push, hasRoute: () => true }), useRoute: () => ({ fullPath: '/', meta: {}, name: 'Home', params: {} }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => me.value }) }));

import { useOnboardingChecklist, MEMBER_STEPS, WORKSPACE_STEPS } from '@/composable/useOnboardingChecklist';
import { resetOnboardingRecord } from '@/composable/onboardingState';
import { isBlockingSurfaceOpen, useBlockingSurface } from '@/composable/blockingSurface';
import { mayAutoOffer } from '@/components/organisms/Tour/tourSteps';
import { USER_ONBOARDING, USER_UPATE } from '@/config/env';

const ROLE = { guest: 0, owner: 1, admin: 2, member: 3 };

const store = (roleType) => createStore({
    modules: {
        projectData: { namespaced: true, getters: { projects: () => ({ data: [{ _id: 'p1', ProjectCode: 'WELCOME', ProjectName: 'Welcome to AlianHub' }, { _id: 'p2', ProjectCode: 'OPS', ProjectName: 'Ops' }] }) } },
        settings: { namespaced: true, getters: { companyUsers: () => [{ userId: 'user-1' }, { userId: 'user-2' }], companyUserDetail: () => ({ roleType }) } },
        users: { namespaced: true, getters: { users: () => [] } }
    }
});

const useChecklist = (roleType) => {
    let api;
    const Host = defineComponent({ setup() { api = useOnboardingChecklist(); return () => h('div'); } });
    mount(Host, { global: { plugins: [store(roleType)] } });
    return api;
};

beforeEach(() => {
    me.value = { _id: 'user-1', tourStatus: {}, homeChecklist: {} };
    resetOnboardingRecord();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: {} } });
    sessionStorage.clear();
    localStorage.clear();
});

describe('one checklist per role', () => {
    it.each(['owner', 'admin'])('gives an %s the workspace steps and the tour', (role) => {
        const keys = useChecklist(ROLE[role]).steps.value.map((s) => s.key);
        expect(keys).toEqual(expect.arrayContaining(['invite', 'project', 'tour']));
    });

    it.each(['member', 'guest'])('gives a %s personal steps only, even when the workspace ones are done', (role) => {
        const steps = useChecklist(ROLE[role]).steps.value;
        expect(steps.map((s) => s.key)).toEqual(MEMBER_STEPS);
        expect(steps.filter((s) => WORKSPACE_STEPS.includes(s.key))).toEqual([]);
        expect(steps.filter((s) => s.done)).toEqual([]);
    });

    it('never lists a workspace step among the member steps', () => {
        expect(MEMBER_STEPS.filter((key) => WORKSPACE_STEPS.includes(key))).toEqual([]);
        expect(WORKSPACE_STEPS).toEqual(expect.arrayContaining(['invite', 'project']));
    });
});

describe('dismissal and progress live on the user record', () => {
    it('stays dismissed when the user record says so, whatever this tab remembers', () => {
        me.value = { ...me.value, homeChecklist: { dismissed: true } };
        sessionStorage.setItem('ah.gs.dismissed', '0');
        expect(useChecklist(ROLE.member).show.value).toBe(false);
    });

    it('shows until dismissed, and dismissing writes to the own-user route', async () => {
        const checklist = useChecklist(ROLE.member);
        expect(checklist.show.value).toBe(true);
        checklist.dismiss();
        await nextTick();
        expect(checklist.show.value).toBe(false);
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', USER_ONBOARDING, { dismissed: true });
        expect(apiRequestWithoutCompnay.mock.calls.some(([, url]) => url === USER_UPATE)).toBe(false);
        expect(sessionStorage.length).toBe(0);
    });

    it('records a step without sending anyone else\'s id', async () => {
        const checklist = useChecklist(ROLE.member);
        checklist.mark('open_project');
        await flushPromises();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', USER_ONBOARDING, { openedProject: true });
        expect(checklist.steps.value.find((s) => s.key === 'open_project').done).toBe(true);
    });

    it('reads progress saved on another device', () => {
        me.value = { ...me.value, homeChecklist: { completedTask: true, viewedNotifications: true } };
        const done = useChecklist(ROLE.member).steps.value.filter((s) => s.done).map((s) => s.key);
        expect(done).toEqual(['complete_task', 'notifications']);
    });
});

describe('the checklist steps aside for panels, bulk bars and dialogs', () => {
    const add = (html) => {
        const el = document.createElement('div');
        el.innerHTML = html;
        document.body.appendChild(el);
        return el;
    };

    beforeEach(() => { document.body.innerHTML = ''; });

    it('sees nothing blocking on a plain page', () => {
        add('<main><section class="hc-mywork"></section></main>');
        expect(isBlockingSurfaceOpen(document)).toBe(false);
    });

    it.each([
        ['the task panel', '<div class="ah-detail"><div role="dialog" aria-label="Task"></div></div>'],
        ['the list bulk bar', '<div class="lv2-bulk" role="region"></div>'],
        ['the board bulk bar', '<div class="bulk-action-bar"></div>'],
        ['a create dialog', '<div role="dialog" aria-modal="true"></div>']
    ])('sees %s', (_name, html) => {
        add(html);
        expect(isBlockingSurfaceOpen(document)).toBe(true);
    });

    it('updates as a panel opens and closes', async () => {
        let blocked;
        const Host = defineComponent({ setup() { blocked = useBlockingSurface(); return () => h('div'); } });
        const wrapper = mount(Host, { attachTo: document.body });
        expect(blocked.value).toBe(false);
        const panel = add('<div class="ah-detail"></div>');
        await flushPromises();
        expect(blocked.value).toBe(true);
        panel.remove();
        await flushPromises();
        expect(blocked.value).toBe(false);
        wrapper.unmount();
    });
});

describe('the tour starts on request, or once', () => {
    const ctx = { done: false, skipped: false, savedStep: 0, offeredBefore: false, wide: true, shellSettled: true };

    it('never starts the shell tour by itself', () => {
        expect(mayAutoOffer('shell', ctx)).toBe(false);
    });

    it('offers a screen tour once, after the shell tour is settled', () => {
        expect(mayAutoOffer('project', ctx)).toBe(true);
        expect(mayAutoOffer('project', { ...ctx, offeredBefore: true })).toBe(false);
        expect(mayAutoOffer('project', { ...ctx, shellSettled: false })).toBe(false);
        expect(mayAutoOffer('project', { ...ctx, wide: false })).toBe(false);
    });

    it('has no floating card and no session-only dismissal left', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../src/components/organisms/Tour/TourComponet.vue'), 'utf8');
        expect(source).not.toMatch(/ah-gs/);
        expect(source).not.toMatch(/sessionStorage/);
    });
});
