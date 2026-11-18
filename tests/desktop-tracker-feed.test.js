const mockCache = new Map();

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({
    myCache: { get: (key) => mockCache.get(key), set: (key, value) => { mockCache.set(key, value); return true; } },
}));
jest.mock('axios', () => ({ get: jest.fn() }));

const axios = require('axios');
const { parseLatestYml, releaseFromManifests, compareVersions, feedBase, latestRelease } = require('../Modules/DesktopTracker/feed');
const { isScreenshotStorageKey } = require('../common-storage/taskFileKeys');

const WINDOWS = `version: 6.0.2
files:
  - url: AlianHub-Tracker-Setup-6.0.2.exe
    sha512: Zm9v==
    size: 98765432
path: AlianHub-Tracker-Setup-6.0.2.exe
sha512: Zm9v==
releaseDate: '2026-10-28T10:00:00.000Z'
`;

const MAC = `version: 6.0.2
files:
  - url: AlianHub-Tracker-6.0.2-universal-mac.zip
    sha512: YmFy==
    size: 1
  - url: AlianHub-Tracker-6.0.2-universal.dmg
    sha512: YmF6==
    size: 2
path: AlianHub-Tracker-6.0.2-universal-mac.zip
sha512: YmFy==
releaseDate: '2026-10-28T10:00:00.000Z'
`;

beforeEach(() => {
    jest.clearAllMocks();
    mockCache.clear();
});

describe('reading an update manifest', () => {
    it('reads the version, the files and the release date', () => {
        expect(parseLatestYml(WINDOWS)).toEqual({
            version: '6.0.2',
            files: [{ url: 'AlianHub-Tracker-Setup-6.0.2.exe', sha512: 'Zm9v==', size: '98765432' }],
            path: 'AlianHub-Tracker-Setup-6.0.2.exe',
            sha512: 'Zm9v==',
            releaseDate: '2026-10-28T10:00:00.000Z',
        });
    });

    it('reads several files and Windows line endings', () => {
        expect(parseLatestYml(MAC.replace(/\n/g, '\r\n')).files.map((f) => f.url)).toEqual(['AlianHub-Tracker-6.0.2-universal-mac.zip', 'AlianHub-Tracker-6.0.2-universal.dmg']);
    });

    it('takes the path when an old manifest lists no files', () => {
        expect(parseLatestYml('version: 5.9.0\npath: Old Setup.exe\n').files).toEqual([{ url: 'Old Setup.exe' }]);
    });

    it.each([['an empty body', ''], ['an HTML error page', '<html><body>Not Found</body></html>'], ['a manifest without a version', 'files:\n  - url: a.exe\n']])('rejects %s', (_label, text) => {
        expect(parseLatestYml(text)).toBeNull();
    });
});

describe('building the downloads', () => {
    const base = 'https://downloads.example.test/tracker';

    it('offers one installer per system, the dmg on a Mac and a deb beside the AppImage', () => {
        const linux = parseLatestYml('version: 6.0.2\nfiles:\n  - url: AlianHub-Tracker-6.0.2-x86_64.AppImage\n');
        const release = releaseFromManifests({ windows: parseLatestYml(WINDOWS), mac: parseLatestYml(MAC), linux }, base, 'stable');
        expect(release).toEqual({
            channel: 'stable',
            version: '6.0.2',
            downloads: [
                { os: 'windows', kind: 'exe', version: '6.0.2', url: `${base}/stable/AlianHub-Tracker-Setup-6.0.2.exe` },
                { os: 'mac', kind: 'dmg', version: '6.0.2', url: `${base}/stable/AlianHub-Tracker-6.0.2-universal.dmg` },
                { os: 'linux', kind: 'AppImage', version: '6.0.2', url: `${base}/stable/AlianHub-Tracker-6.0.2-x86_64.AppImage` },
                { os: 'linux', kind: 'deb', version: '6.0.2', url: `${base}/stable/AlianHub-Tracker-6.0.2-amd64.deb` },
            ],
        });
    });

    it('escapes a file name with spaces and keeps a full address as it is', () => {
        const release = releaseFromManifests({
            windows: parseLatestYml('version: 6.0.0\nfiles:\n  - url: AlianHub Tracker Setup.exe\n'),
            mac: parseLatestYml('version: 6.1.0\nfiles:\n  - url: https://cdn.example.test/a.dmg\n'),
        }, base, 'beta');
        expect(release.downloads.map((d) => d.url)).toEqual([`${base}/beta/AlianHub%20Tracker%20Setup.exe`, 'https://cdn.example.test/a.dmg']);
        expect(release.version).toBe('6.1.0');
    });

    it('offers nothing when no manifest could be read', () => {
        expect(releaseFromManifests({ windows: null, mac: null, linux: null }, base, 'stable')).toBeNull();
    });

    it('compares versions by number, not by text', () => {
        expect(compareVersions('6.10.0', '6.9.9')).toBe(1);
        expect(compareVersions('6.0.0', '6.0.0-beta.3')).toBe(0);
        expect(compareVersions('5.1.6', '6.0.0')).toBe(-1);
    });
});

describe('fetching the feed', () => {
    it('reads the stable folder of the AlianHub feed by default', async () => {
        axios.get.mockResolvedValue({ data: WINDOWS });
        const release = await latestRelease({ env: {} });
        expect(axios.get.mock.calls.map(([url]) => url)).toEqual([
            'https://downloads.alianhub.com/tracker/stable/latest.yml',
            'https://downloads.alianhub.com/tracker/stable/latest-mac.yml',
            'https://downloads.alianhub.com/tracker/stable/latest-linux.yml',
        ]);
        expect(release.version).toBe('6.0.2');
    });

    it('fetches once and answers from memory after that, a miss included', async () => {
        axios.get.mockRejectedValue(new Error('timeout'));
        expect(await latestRelease({ env: {} })).toBeNull();
        expect(await latestRelease({ env: {} })).toBeNull();
        expect(axios.get).toHaveBeenCalledTimes(3);
    });

    it('fetches nothing when the instance has no feed', async () => {
        expect(feedBase({ TRACKER_UPDATE_URL: 'off' })).toBeNull();
        expect(await latestRelease({ env: { TRACKER_UPDATE_URL: 'off' } })).toBeNull();
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('takes a self-hosted feed without its trailing slash, and only a known channel', async () => {
        expect(feedBase({ TRACKER_UPDATE_URL: 'https://files.example.test/tracker/' })).toBe('https://files.example.test/tracker');
        expect(await latestRelease({ channel: '../../etc', env: {} })).toBeNull();
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('screenshot storage', () => {
    it.each([
        ['Project/6f0000000000000000000a01/Sprint/6f0000000000000000000e01/TimeLog/6f0000000000000000000d01/1700000000.png', true],
        ['Project/6f0000000000000000000a01/Sprint/6f0000000000000000000e01/TimeLog/6f0000000000000000000d01/1700000000-140x78.png', true],
        ['Project\\6f0000000000000000000a01\\Sprint\\6f0000000000000000000e01\\TimeLog\\6f0000000000000000000d01\\a.png', true],
        ['Project/6f0000000000000000000a01/Sprint/6f0000000000000000000e01/Task/a.pdf', false],
        ['companyIcon/logo.png', false],
    ])('counts %s as a screenshot: %s', (key, expected) => {
        expect(isScreenshotStorageKey(key)).toBe(expected);
    });
});
