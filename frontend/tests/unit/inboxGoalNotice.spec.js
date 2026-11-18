/* Task 046 M3: the Inbox line for a target or a goal that was reached. It is rendered from the
   row's values through i18n, never from stored HTML, and says who did it only when a person did. */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import fs from 'fs';
import path from 'path';
import { renderNotice } from '@/views/Inbox/renderNotice';
import en from '@/locales/en';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const t = i18n.global.t;
const passThrough = (text) => text;
const row = (changeData) => ({ changeType: 'goal_reached', key: changeData.targetId ? 'goal_target_reached' : 'goal_reached', message: 'stored text', changeData });
const lineOf = (changeData) => renderNotice(row(changeData), { t, changeText: passThrough });

describe('the Inbox line for a reached target or goal', () => {
    it('reads on from the name of the person who set the value', () => {
        expect(lineOf({ goalId: 'g1', goalName: 'Launch the site', targetId: 't1', targetName: 'Docs written', byCount: false })).toBe('reached the target Docs written of the goal Launch the site.');
        expect(lineOf({ goalId: 'g1', goalName: 'Launch the site', byCount: false })).toBe('brought the goal Launch the site to 100%.');
    });

    it('stands on its own when a count reached it', () => {
        expect(lineOf({ goalId: 'g1', goalName: 'Launch the site', targetId: 't1', targetName: 'Launch tasks', byCount: true })).toBe('The target Launch tasks of the goal Launch the site is reached.');
        expect(lineOf({ goalId: 'g1', goalName: 'Launch the site', byCount: true })).toBe('The goal Launch the site is reached.');
    });

    it('renders names carrying markup as text', () => {
        const html = lineOf({ goalId: 'g1', goalName: '<img src=x onerror=alert(1)>', targetId: 't1', targetName: '<b>Bold</b>', byCount: true });
        const wrapper = mount({ template: '<p v-html="html"></p>', data: () => ({ html }) });
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.text()).toContain('<b>Bold</b>');
    });

    it('falls back to the stored message when the row names no goal', () => {
        expect(renderNotice({ changeType: 'goal_reached', message: 'Fixed text' }, { t, changeText: passThrough })).toBe('Fixed text');
    });
});

describe('the Inbox and the settings page', () => {
    const read = (file) => fs.readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');

    it('open the goal from the row, in a build that has the goal page', () => {
        expect(read('views/Inbox/Inbox.vue')).toContain("if (it.changeType === 'goal_reached' && it.changeData?.goalId && router.hasRoute('Goal')) {");
        expect(read('views/Inbox/Inbox.vue')).toContain("router.push({ name: 'Goal', params: { cid: companyId?.value, goalId: String(it.changeData.goalId) } })");
    });

    it('name the Goals section and its two switches', () => {
        expect(read('views/Settings/Notifications/Notifications.vue')).toMatch(/SECTION_ORDER = \[[^\]]*"docs", "goals"/);
        expect(en.Notification).toMatchObject({ goals: 'Goals', goal_target_reached: 'Targets reached on my goals', goal_reached: 'Goals reached' });
    });
});
