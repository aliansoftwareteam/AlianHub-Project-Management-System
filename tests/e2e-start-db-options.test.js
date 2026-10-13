const { optionsFrom } = require('../e2e/support/start-db');

describe('npm run e2e:db options', () => {
    it('keeps the original database on 27018 by default', () => {
        expect(optionsFrom([])).toEqual({ port: 27018, stop: false, container: 'alianhub-e2e-mongo', url: 'mongodb://127.0.0.1:27018' });
    });

    it('starts an independent database on another port for a parallel run', () => {
        expect(optionsFrom(['--port', '27120'])).toEqual({ port: 27120, stop: false, container: 'alianhub-e2e-mongo-27120', url: 'mongodb://127.0.0.1:27120' });
    });

    it('stops the database for that port', () => {
        expect(optionsFrom(['--port', '27120', '--stop'])).toMatchObject({ stop: true, container: 'alianhub-e2e-mongo-27120' });
    });

    it.each([['27017'], ['80'], ['70000'], ['abc'], [undefined]])('refuses port %s', (value) => {
        expect(() => optionsFrom(['--port', value])).toThrow(/--port/);
    });
});
