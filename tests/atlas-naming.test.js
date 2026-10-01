const { fileName, parseFileName, parseSize, parseArgs, isScreenName, timestamp } = require('../scripts/atlas/naming');
const { readToken, userIdOf } = require('../scripts/atlas/session');

describe('atlas file naming', () => {
    test('a shot is named screen, theme and size', () => {
        expect(fileName({ screen: 'project-board', theme: 'dark', size: '1440x900' })).toBe('project-board__dark__1440x900.png');
    });

    test('a file name reads back to the same parts', () => {
        expect(parseFileName('project-board__dark__1440x900.png')).toEqual({ screen: 'project-board', theme: 'dark', size: '1440x900' });
    });

    test('anything else in the folder is not a shot', () => {
        expect(parseFileName('index.html')).toBeNull();
        expect(parseFileName('home__dark.png')).toBeNull();
        expect(parseFileName('home__dark__wide.png')).toBeNull();
    });

    test('a screen name cannot break the separator', () => {
        expect(isScreenName('settings-my-profile')).toBe(true);
        expect(isScreenName('settings__profile')).toBe(false);
        expect(isScreenName('Settings')).toBe(false);
        expect(isScreenName('a/b')).toBe(false);
    });

    test('a size is width by height', () => {
        expect(parseSize('390x844')).toEqual({ label: '390x844', width: 390, height: 844 });
        expect(() => parseSize('phone')).toThrow('390x844');
    });

    test('the default folder name sorts by time and is safe on every file system', () => {
        expect(timestamp(new Date('2026-10-01T07:05:09Z'))).toBe('20261001-070509');
    });
});

describe('atlas arguments', () => {
    test('defaults', () => {
        expect(parseArgs([])).toMatchObject({
            baseUrl: 'http://localhost:4000',
            themes: ['light', 'dark'],
            sizes: [{ label: '1440x900', width: 1440, height: 900 }, { label: '390x844', width: 390, height: 844 }],
            only: null,
            variant: null,
            out: null,
        });
    });

    test('lists are comma separated', () => {
        const args = parseArgs(['--base-url', 'http://localhost:4100/', '--only', 'home, inbox', '--themes=dark', '--sizes', '1440x900', '--variant', 'b', '--out', 'shots']);
        expect(args).toMatchObject({ baseUrl: 'http://localhost:4100', only: ['home', 'inbox'], themes: ['dark'], variant: 'b', out: 'shots' });
        expect(args.sizes.map((size) => size.label)).toEqual(['1440x900']);
    });

    test('an unknown theme or variant is refused', () => {
        expect(() => parseArgs(['--themes', 'sepia'])).toThrow('light, dark');
        expect(() => parseArgs(['--variant', 'z'])).toThrow('a, b, c');
    });
});

describe('atlas session', () => {
    const jwt = (claims) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

    test('the token comes from the environment', () => {
        expect(readToken({ env: { ATLAS_TOKEN: ' abc \n' } })).toBe('abc');
    });

    test('or from a token file', () => {
        const readFile = jest.fn(() => 'from-file\n');
        expect(readToken({ env: { ATLAS_TOKEN_FILE: '/tmp/t' }, readFile })).toBe('from-file');
        expect(readToken({ env: {}, tokenFile: '/tmp/u', readFile })).toBe('from-file');
        expect(readFile).toHaveBeenLastCalledWith('/tmp/u', 'utf8');
    });

    test('with neither it says how to get one and prints no secret', () => {
        expect(() => readToken({ env: {} })).toThrow('ATLAS_TOKEN');
    });

    test('the user id is read from the token, not asked for', () => {
        expect(userIdOf(jwt({ uid: 'u1' }))).toBe('u1');
    });

    test('a token that is not a session token is refused without echoing it', () => {
        expect(() => userIdOf('not-a-token')).toThrow(/session token/);
        try {
            userIdOf('secret-value');
        } catch (error) {
            expect(error.message).not.toContain('secret-value');
        }
    });
});
