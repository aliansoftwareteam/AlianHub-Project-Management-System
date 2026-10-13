describe('npm run migrate up', () => {
    const saved = { argv: process.argv, mongoUrl: process.env.MONGODB_URL };

    afterEach(() => {
        process.argv = saved.argv;
        if (saved.mongoUrl === undefined) delete process.env.MONGODB_URL;
        else process.env.MONGODB_URL = saved.mongoUrl;
        jest.restoreAllMocks();
        jest.resetModules();
    });

    it('reads git before running, so every migration records the build git reports and not package.json', async () => {
        let started = false;
        let recorded = null;
        const buildInfo = {
            start: jest.fn(async () => { started = true; }),
            get: () => ({ version: started ? '14.36.0-beta.9' : '14.35.0' }),
        };
        jest.doMock('../Config/applyEnv', () => ({ loadDotEnv: () => {} }));
        jest.doMock('../Config/buildInfo', () => buildInfo);
        jest.doMock('../migrations/report', () => ({}));
        jest.doMock('../migrations', () => ({
            liveDeps: () => ({}),
            runMigrations: async () => {
                recorded = buildInfo.get().version;
                return { skipped: false, applied: ['001-a'], pending: [], failed: null };
            },
        }));
        jest.spyOn(console, 'log').mockImplementation(() => {});
        const exited = new Promise((resolve) => jest.spyOn(process, 'exit').mockImplementation(resolve));
        process.argv = ['node', 'scripts/migrate.js', 'up'];
        process.env.MONGODB_URL = 'mongodb://127.0.0.1:1/unused';

        require('../scripts/migrate');

        expect(await exited).toBe(0);
        expect(buildInfo.start).toHaveBeenCalledTimes(1);
        expect(recorded).toBe('14.36.0-beta.9');
    });
});
