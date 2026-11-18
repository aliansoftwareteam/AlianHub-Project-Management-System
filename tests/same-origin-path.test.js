const { sameOriginPath } = require('../Modules/Auth/helpers/sameOriginPath');

describe('sameOriginPath', () => {
    it.each([
        ['/6f00000000000000000000c1/project/p1/list?view=board', '/6f00000000000000000000c1/project/p1/list?view=board'],
        ['/invitation?companyId=a-b&token=t', '/invitation?companyId=a-b&token=t'],
        ['  /oauth/consent  ', '/oauth/consent'],
    ])('keeps the path %s on this site', (raw, kept) => {
        expect(sameOriginPath(raw)).toBe(kept);
    });

    it.each([
        ['another host behind two slashes', '//evil.test/x'],
        ['another host behind a backslash', '/\\evil.test'],
        ['an absolute address', 'https://evil.test/x'],
        ['a script address', 'javascript:alert(1)'],
        ['a relative path', 'project/p1'],
        ['an empty value', ''],
        ['a repeated query parameter', ['/a', '/b']],
        ['nothing', undefined],
        ['an address too long for any page here', `/${'a'.repeat(2048)}`],
    ])('drops %s', (_what, raw) => {
        expect(sameOriginPath(raw)).toBe('');
    });
});
