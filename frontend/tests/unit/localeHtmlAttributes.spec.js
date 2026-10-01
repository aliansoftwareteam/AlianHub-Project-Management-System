import { beforeEach, describe, expect, it } from 'vitest';
import { switchLocale } from '@/locales/main';

const html = document.documentElement;

beforeEach(async () => {
    await switchLocale('en');
});

describe('<html> follows the active language', () => {
    it('updates lang on every switch, in both directions', async () => {
        await switchLocale('fr');
        expect(html.lang).toBe('fr');
        await switchLocale('en');
        expect(html.lang).toBe('en');
    });

    it('keeps lang and dir together when the language is right-to-left', async () => {
        await switchLocale('ar');
        expect(html.lang).toBe('ar');
        expect(html.dir).toBe('rtl');
        await switchLocale('fr');
        expect(html.dir).toBe('ltr');
    });

    it('maps a locale code that is not a BCP 47 tag', async () => {
        await switchLocale('ptBr');
        expect(html.lang).toBe('pt-BR');
    });
});
