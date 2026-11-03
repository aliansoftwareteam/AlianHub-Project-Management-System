/* Task 074: the bell line owners and admins get when migration 080 retires the Slack workspace bot. It is
   rendered from i18n, never from the stored English message. */
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import { renderNotice } from '@/views/Inbox/renderNotice';
import en from '@/locales/en';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const t = i18n.global.t;
const row = { changeType: 'connector_slack_bot_retired', key: 'connector_slack_bot_retired', message: 'stored <b>text</b>', changeData: { provider: 'slack' } };

describe('the Inbox line for the retired Slack bot', () => {
    it('says the bot was retired and where each person connects their own Slack', () => {
        const line = renderNotice(row, { t, changeText: () => 'stored text was used' });
        expect(line).toBe(t('Inbox.connector_slack_bot_retired'));
        expect(line).toMatch(/My connections/);
        expect(line).not.toContain('stored');
    });
});
