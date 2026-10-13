const { backendReads, frontendReads, readByText, metaShapeProblems, driftReport } = require('../scripts/env-doc');

const file = (path, text) => ({ path, text });

describe('what the code reads', () => {
    const first = file('Config/a.js', 'const port = process.env.PORT;');
    const second = file('Modules/m.js', 'const port = process.env.PORT || 4000;');
    const third = file('utils/z.js', "const port = process.env.PORT || '5000';");

    it('lists a variable\'s readers in one order, whatever order the files are found in', () => {
        const expected = { PORT: { files: ['Config/a.js', 'Modules/m.js', 'utils/z.js'], default: '4000' } };
        expect(backendReads([first, second, third])).toEqual(expected);
        expect(backendReads([third, second, first])).toEqual(expected);
    });

    it('takes the default from the alphabetically first file that names one', () => {
        expect(backendReads([third, first]).PORT.default).toBe('5000');
        expect(backendReads([first]).PORT.default).toBeUndefined();
    });

    it('reads the bracket form and an alias of process.env', () => {
        const reads = backendReads([
            file('Config/b.js', "const key = process.env['API_KEY'];"),
            file('Config/c.js', "const read = (env = process.env) => env.MODE || 'off';"),
        ]);
        expect(reads).toEqual({ API_KEY: { files: ['Config/b.js'], default: undefined }, MODE: { files: ['Config/c.js'], default: 'off' } });
    });

    it('lists one file once however often it reads a variable', () => {
        expect(backendReads([file('Config/a.js', 'process.env.PORT; process.env.PORT;')]).PORT.files).toEqual(['Config/a.js']);
    });

    it('finds the frontend variables', () => {
        expect(frontendReads([file('frontend/src/b.js', 'process.env.VUE_APP_API'), file('frontend/src/a.vue', 'VUE_APP_API')])).toEqual({
            VUE_APP_API: { files: ['frontend/src/a.vue', 'frontend/src/b.js'] },
        });
    });
});

describe('the read by column', () => {
    it('names up to two readers', () => {
        expect(readByText(['Config/a.js'])).toBe('`Config/a.js`');
        expect(readByText(['Config/a.js', 'Modules/m.js'])).toBe('`Config/a.js`, `Modules/m.js`');
    });

    it('prints the same text for three readers as for ten, so one more reader does not change the row', () => {
        const three = readByText(['Config/a.js', 'Modules/m.js', 'utils/z.js']);
        expect(three).toBe('`Config/a.js`, `Modules/m.js` and others');
        expect(readByText(['Config/a.js', 'Modules/m.js', 'utils/y.js', 'utils/z.js', 'utils/zz.js'])).toBe(three);
    });
});

describe('the descriptions file by itself', () => {
    const valid = {
        PORT: { group: 'server', description: 'The port the server listens on.', default: '4000' },
        JWT_SECRET: { group: 'auth', description: 'Signs sessions.', secret: true, required: true },
        SENTRY_DSN: { group: 'logging', description: 'Read by the SDK, not by this code.', external: true },
    };

    it('is accepted when every entry has a valid shape', () => {
        expect(metaShapeProblems(valid)).toEqual([]);
    });

    it('refuses anything but an object of entries', () => {
        expect(metaShapeProblems([])).toEqual(['scripts/env-doc.meta.json must be an object of variables']);
        expect(metaShapeProblems(null)).toHaveLength(1);
    });

    it('refuses an unknown group, a missing description, a flag that is not true or false and an unknown field', () => {
        expect(metaShapeProblems({
            A_VAR: { group: 'misc', description: 'A.' },
            B_VAR: { group: 'server' },
            C_VAR: { group: 'server', description: 'C.', secret: 'yes' },
            D_VAR: { group: 'server', description: 'D.', note: 'x' },
            E_VAR: { group: 'server', description: 'E.', default: 4000 },
            F_VAR: 'server',
        })).toEqual([
            'unknown group "misc": A_VAR',
            'no description: B_VAR',
            '"secret" must be true or false: C_VAR',
            'unknown field "note": D_VAR',
            '"default" must be text: E_VAR',
            'entry is not an object: F_VAR',
        ]);
    });
});

describe('what drift costs', () => {
    const drift = {
        undescribed: ['NEW_VAR'],
        unread: ['OLD_VAR'],
        stale: ['out of date: docs/ENV.md (run node scripts/env-doc.js)'],
    };

    it('fails a pull request only on a variable it reads without describing', () => {
        expect(driftReport(drift)).toEqual({
            problems: ['used but not described in scripts/env-doc.meta.json: NEW_VAR'],
            warnings: ['out of date: docs/ENV.md (run node scripts/env-doc.js)', 'described but never read: OLD_VAR'],
        });
    });

    it('also fails on stale files and a description nothing reads when strict', () => {
        expect(driftReport(drift, true)).toEqual({
            problems: [
                'used but not described in scripts/env-doc.meta.json: NEW_VAR',
                'out of date: docs/ENV.md (run node scripts/env-doc.js)',
                'described but never read: OLD_VAR',
            ],
            warnings: [],
        });
    });

    it('passes both ways with nothing to report', () => {
        const none = { undescribed: [], unread: [], stale: [] };
        expect(driftReport(none)).toEqual({ problems: [], warnings: [] });
        expect(driftReport(none, true)).toEqual({ problems: [], warnings: [] });
    });
});
