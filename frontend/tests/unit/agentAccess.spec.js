import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { canControlRun, canManageAgents, canUndoDecision, useAgentAccess } from '@/views/Ai/agentAccess';

const OWNER = 1;
const ADMIN = 2;
const MEMBER = 3;
const GUEST = 4;

describe('canManageAgents', () => {
    it('lets owners and admins manage agents and refuses members and guests', () => {
        expect(canManageAgents(OWNER)).toBe(true);
        expect(canManageAgents(ADMIN)).toBe(true);
        expect(canManageAgents(MEMBER)).toBe(false);
        expect(canManageAgents(GUEST)).toBe(false);
        expect(canManageAgents('1')).toBe(true);
        expect(canManageAgents(undefined)).toBe(false);
    });
});

describe('canControlRun', () => {
    const run = { _id: 'r1', startedBy: 'u1' };

    it('lets owners and admins stop anyone\'s run', () => {
        expect(canControlRun(run, { userId: 'u9', roleType: OWNER })).toBe(true);
        expect(canControlRun(run, { userId: 'u9', roleType: ADMIN })).toBe(true);
    });

    it('lets a member or guest stop only the run they started', () => {
        for (const roleType of [MEMBER, GUEST]) {
            expect(canControlRun(run, { userId: 'u1', roleType })).toBe(true);
            expect(canControlRun(run, { userId: 'u9', roleType })).toBe(false);
        }
    });

    it('refuses when there is no run, no caller or no starter', () => {
        expect(canControlRun(null, { userId: 'u1', roleType: OWNER })).toBe(false);
        expect(canControlRun(run, { roleType: MEMBER })).toBe(false);
        expect(canControlRun({ _id: 'r2' }, { userId: '', roleType: MEMBER })).toBe(false);
        expect(canControlRun({ _id: 'r2', startedBy: '' }, { userId: '', roleType: MEMBER })).toBe(false);
    });
});

describe('canUndoDecision', () => {
    const proposal = { _id: 'p1', decidedBy: 'u1' };

    it('lets owners and admins undo any decision', () => {
        expect(canUndoDecision(proposal, { userId: 'u9', roleType: OWNER })).toBe(true);
        expect(canUndoDecision(proposal, { userId: 'u9', roleType: ADMIN })).toBe(true);
    });

    it('lets a member or guest undo only their own decision', () => {
        for (const roleType of [MEMBER, GUEST]) {
            expect(canUndoDecision(proposal, { userId: 'u1', roleType })).toBe(true);
            expect(canUndoDecision(proposal, { userId: 'u9', roleType })).toBe(false);
        }
        expect(canUndoDecision(null, { userId: 'u1', roleType: OWNER })).toBe(false);
    });
});

describe('useAgentAccess', () => {
    const probe = ({ roleType, userId }) => {
        let access;
        const Probe = defineComponent({ setup() { access = useAgentAccess(); return () => h('div'); } });
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });
        mount(Probe, { global: { plugins: [store], provide: { $userId: ref(userId) } } });
        return access;
    };

    it('reads the role from the store and the caller from the injected user id', () => {
        const member = probe({ roleType: MEMBER, userId: 'u1' });
        expect(member.canManage.value).toBe(false);
        expect(member.mayStop({ startedBy: 'u1' })).toBe(true);
        expect(member.mayStop({ startedBy: 'u2' })).toBe(false);
        expect(member.mayUndo({ decidedBy: 'u2' })).toBe(false);

        const admin = probe({ roleType: ADMIN, userId: 'u1' });
        expect(admin.canManage.value).toBe(true);
        expect(admin.mayStop({ startedBy: 'u2' })).toBe(true);
        expect(admin.mayUndo({ decidedBy: 'u2' })).toBe(true);
    });
});
