/* Task 047 AI-4d: the Inbox line that says a token or a connected app's access is about to end. It is
   rendered from the row's values through i18n, never from stored HTML. */
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
const ENDS = '2026-10-04T09:00:00.000Z';
const day = new Date(ENDS).toLocaleDateString();
const row = (changeData) => ({ changeType: 'credential_expiring', key: 'credential_expiring', message: 'stored text', changeData });
const lineOf = (changeData) => renderNotice(row(changeData), { t, changeText: passThrough });

describe('the Inbox line for a token or a connection about to end', () => {
    it('names the token by its label and says when it ends and where to renew it', () => {
        const line = lineOf({ kind: 'token', name: 'Laptop agent', tokenId: 't1', expiresAt: ENDS });
        expect(line).toBe(t('Inbox.credential_expiring_token', { name: 'Laptop agent', date: day }));
        expect(line).toContain('Laptop agent');
        expect(line).toContain(day);
        expect(line).toMatch(/Renew/);
    });

    it('names the connected app and says it is renewed by connecting again', () => {
        const line = lineOf({ kind: 'connection', name: 'Claude', grantId: 'g1', expiresAt: ENDS });
        expect(line).toBe(t('Inbox.credential_expiring_connection', { name: 'Claude', date: day }));
        expect(line).toMatch(/[Cc]onnect/);
    });

    it('renders a label carrying markup as text', () => {
        const html = lineOf({ kind: 'token', name: '<img src=x onerror=alert(1)><b>Bold</b>', expiresAt: ENDS });
        const wrapper = mount({ template: '<p v-html="html"></p>', data: () => ({ html }) });
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.text()).toContain('<b>Bold</b>');
    });

    it('falls back to the stored message when the row names nothing or no day', () => {
        expect(lineOf({ kind: 'token', expiresAt: ENDS })).toBe('stored text');
        expect(lineOf({ kind: 'token', name: 'Laptop', expiresAt: 'soon' })).toBe('stored text');
        expect(renderNotice({ changeType: 'credential_expiring', message: 'Fixed text' }, { t, changeText: passThrough })).toBe('Fixed text');
    });
});

describe('the Inbox row', () => {
    const read = (file) => fs.readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');

    it('opens the accounts page on the tokens, or on the connected apps for a connection', () => {
        const source = read('views/Inbox/Inbox.vue');
        expect(source).toContain("if (it.changeType === 'credential_expiring' && router.hasRoute('AiAccounts')) {");
        expect(source).toContain("router.push({ name: 'AiAccounts', params: { cid: companyId?.value }, query: { tab: it.changeData?.kind === 'connection' ? 'connected' : 'link' } })");
    });
});
