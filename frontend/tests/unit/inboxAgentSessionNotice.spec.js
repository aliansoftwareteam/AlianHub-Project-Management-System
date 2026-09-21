import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { renderNotice } from '@/views/Inbox/inboxNotices';
import en from '@/locales/en';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const t = i18n.global.t;
const passThrough = (text) => text;

const row = (changeData) => ({
    changeType: 'agent_session_assigned',
    message: 'A task delegated to an outside agent is now assigned to you.',
    changeData,
});

describe('the Inbox line for a delegation notice', () => {
    it('renders client and task names carrying markup as text', () => {
        const html = renderNotice(row({ clientName: 'Coder <img src=x onerror=alert(1)>', taskKey: 'AH-7', taskName: '<b>Parser</b>' }), { t, changeText: passThrough });
        const wrapper = mount({ template: '<p v-html="html"></p>', data: () => ({ html }) });
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.text()).toContain('Coder <img src=x onerror=alert(1)>');
        expect(wrapper.text()).toContain('<b>Parser</b>');
        expect(wrapper.text()).toContain('AH-7');
    });

    it('falls back to the plain message when the row carries no values', () => {
        expect(renderNotice({ changeType: 'agent_session_assigned', message: 'Fixed text' }, { t, changeText: passThrough })).toBe('Fixed text');
    });

    it('leaves other rows to changeText', () => {
        expect(renderNotice({ changeType: 'task_status', message: 'moved' }, { t, changeText: (text) => `[${text}]` })).toBe('[moved]');
    });
});
