const R = require('../Modules/Integrations/helpers/integrationsRules');

describe('catalog', () => {
    test('non-empty, every item has key/name/fields', () => {
        const c = R.getCatalog();
        expect(c.length).toBeGreaterThanOrEqual(5);
        c.forEach((i) => { expect(i.key).toBeTruthy(); expect(i.name).toBeTruthy(); expect(Array.isArray(i.fields)).toBe(true); });
    });
    test('getCatalog never leaks secret values (only field metadata)', () => {
        const slack = R.getCatalog().find((i) => i.key === 'slack');
        expect(slack.fields.find((f) => f.key === 'verification_token').secret).toBe(true);
    });
});

describe('validateConnection', () => {
    test('known type, filters to allowed fields', () => {
        const v = R.validateConnection({ type: 'slack', config: { verification_token: 's3cr3t', default_channel: '#dev', hacker: 'x' } });
        expect(v.valid).toBe(true);
        expect(v.value).toMatchObject({ type: 'slack', name: 'Slack' });
        expect(v.value.config).toEqual({ verification_token: 's3cr3t', default_channel: '#dev' });
    });
    test('unknown type rejected', () => {
        expect(R.validateConnection({ type: 'nope' }).valid).toBe(false);
    });
    test('custom_iframe requires a valid https url', () => {
        expect(R.validateConnection({ type: 'custom_iframe', config: { name: 'X', url: 'ftp://x' } }).valid).toBe(false);
        const ok = R.validateConnection({ type: 'custom_iframe', config: { name: 'Grafana', url: 'https://g.example.com' } });
        expect(ok.valid).toBe(true);
        expect(ok.value.name).toBe('Grafana');
    });
});

describe('isEmbeddableUrl (AUTO-07)', () => {
    test('https only', () => {
        expect(R.isEmbeddableUrl('https://g.example.com')).toBe(true);
        expect(R.isEmbeddableUrl('http://x.com')).toBe(false);
        expect(R.isEmbeddableUrl('javascript:alert(1)')).toBe(false);
        expect(R.isEmbeddableUrl('')).toBe(false);
    });
});

describe('redact', () => {
    test('hides secret values, reports which are set', () => {
        const r = R.redact({ type: 'slack', config: { verification_token: 's3cr3t', default_channel: '#dev' } });
        expect(r.config.verification_token).toBeUndefined();
        expect(r.config.default_channel).toBe('#dev');
        expect(r.secrets.verification_token).toBe(true);
    });
});
