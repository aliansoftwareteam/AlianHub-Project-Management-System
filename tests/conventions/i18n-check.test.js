/* Gate for scripts/i18n-check.js: every locale carries every en.js key (the
   backfill keeps it so) and no .vue file adds hardcoded template text beyond
   its allowlisted baseline. */
const { checkLocales, scanTemplate, scanHardcoded, readAllowlist, compareToAllowlist } = require('../../scripts/i18n-check');

describe('locale coverage', () => {
    const locales = checkLocales();

    test('every locale file loads and is compared', () => {
        expect(locales.length).toBeGreaterThanOrEqual(13);
    });

    test.each(locales.map((l) => [l.code, l]))('%s has every key en.js has', (_code, locale) => {
        if (locale.missing.length) {
            throw new Error(`${locale.missing.length} key(s) missing, e.g. ${locale.missing.slice(0, 5).join(', ')} — run npm run i18n:backfill`);
        }
    });
});

describe('hardcoded template text', () => {
    test('the scanner flags bare text and static labels but not $t() or bindings', () => {
        const findings = scanTemplate(`
            <div title="Plain title" :placeholder="$t('x')">Save changes</div>
            <span>{{ $t('A.b') }}</span>
            <button aria-label="Close">×</button>
            <p>{{ count }} · {{ $t('A.c') }}</p>
            <input placeholder="Type here">
        `);
        expect(findings.map((f) => `${f.kind}:${f.value}`).sort()).toEqual([
            'aria-label:Close', 'placeholder:Type here', 'text:Save changes', 'title:Plain title'
        ]);
    });

    test('no file exceeds its allowlisted count', () => {
        const { over } = compareToAllowlist(scanHardcoded(), readAllowlist());
        if (over.length) {
            const lines = over.map((o) => `${o.file}: ${o.found} > ${o.allowed}\n    ${o.samples.map((s) => `line ${s.line} ${s.kind}: ${JSON.stringify(s.value)}`).join('\n    ')}`);
            throw new Error(`Hardcoded text added:\n  ${lines.join('\n  ')}\nWrap it in $t() or raise scripts/i18n-allowlist.json deliberately.`);
        }
    });
});
