/* Task 046: an approved timesheet week had no way back. The people who may approve it can reopen it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import fs from 'fs';
import path from 'path';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import * as env from '@/config/env';
import en from '@/locales/en';
import ReopenWeek from '@/views/Timesheet/UserTimeSheet/ReopenWeek.vue';
import { lastReopenOf } from '@/views/Approvals/approvalAccess';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const OWNER = 1;
const ADMIN = 2;
const MEMBER = 3;
const week = (extra = {}) => ({ _id: 'w1', userId: 'u2', status: 'approved', reviewedBy: 'u1', reviewerName: 'Asha Admin', ...extra });

const mounted = [];
const show = (roleType, approval = week()) => {
    const wrapper = mount(ReopenWeek, {
        props: { approval, personName: 'Mira Member', range: 'Sep 28 – Oct 4' },
        attachTo: document.body,
        global: { plugins: [createStore({ getters: { 'settings/companyUserDetail': () => ({ roleType }) } })] }
    });
    mounted.push(wrapper);
    return wrapper;
};
const button = (wrapper) => wrapper.find('[data-test="reopen-week"]');
const dialog = () => document.body.querySelector('[role="alertdialog"]');
const confirm = async () => {
    document.body.querySelector('[data-action="confirm"]').click();
    await flushPromises();
};

beforeEach(() => { apiRequest.mockReset(); });
afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = '';
});

describe('who sees Reopen', () => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s, on an approved week', (label, roleType) => {
        expect(button(show(roleType)).text()).toBe('Reopen');
    });

    it('not the person whose week it is', () => {
        expect(button(show(MEMBER)).exists()).toBe(false);
    });

    it.each(['submitted', 'rejected'])('no one on a %s week, or on a week that was never submitted', (status) => {
        expect(button(show(OWNER, week({ status }))).exists()).toBe(false);
        expect(button(show(OWNER, null)).exists()).toBe(false);
    });
});

describe('reopening', () => {
    it('asks first and sends nothing until it is confirmed', async () => {
        const wrapper = show(OWNER);
        await button(wrapper).trigger('click');
        expect(dialog().textContent).toContain('Reopen this week?');
        expect(dialog().textContent).toContain('Mira Member');
        expect(dialog().textContent).toContain('Sep 28 – Oct 4');
        expect(apiRequest).not.toHaveBeenCalled();

        document.body.querySelector('.rw__actions .ah-btn--secondary').click();
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('sends the reopen through the review route the approval used and hands back the week', async () => {
        const reopened = week({ status: 'submitted', reviewedBy: '', reviewerName: '', history: [{ action: 'reopen', by: 'u9', byName: 'Olive Owner', at: '2026-10-01T10:00:00.000Z' }] });
        apiRequest.mockResolvedValue({ data: { status: true, data: reopened } });
        const wrapper = show(OWNER);
        await button(wrapper).trigger('click');
        await confirm();

        expect(apiRequest).toHaveBeenCalledWith('post', `${env.TIMESHEET_APPROVAL}/w1/review`, { action: 'reopen' });
        expect(wrapper.emitted('reopened')).toEqual([[reopened]]);
        expect(dialog()).toBeNull();
    });

    it('keeps the question open and says why when the server refuses', async () => {
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Only an owner or admin can review timesheets.' } });
        const wrapper = show(OWNER);
        await button(wrapper).trigger('click');
        await confirm();

        expect(dialog().textContent).toContain('Only an owner or admin can review timesheets.');
        expect(wrapper.emitted('reopened')).toBeUndefined();
    });
});

describe('the week\'s history', () => {
    it('gives the last reopening, or nothing', () => {
        expect(lastReopenOf(null)).toBeNull();
        expect(lastReopenOf(week())).toBeNull();
        const history = [{ action: 'reopen', byName: 'Olive Owner', at: '2026-10-01T10:00:00.000Z' }, { action: 'reopen', byName: 'Asha Admin', at: '2026-10-02T10:00:00.000Z' }];
        expect(lastReopenOf(week({ history }))).toEqual(history[1]);
    });

    it('is shown on the week, with the control beside the status', () => {
        const page = fs.readFileSync(path.resolve(__dirname, '../../src/views/Timesheet/UserTimeSheet/UserTimesheet.vue'), 'utf8');
        expect(page).toMatch(/<ReopenWeek[\s\S]*?@reopened=/);
        expect(page).toMatch(/Time\.reopened_by/);
        expect(en.Time.reopened_by).toBe('Reopened by {name} on {date}');
    });
});
