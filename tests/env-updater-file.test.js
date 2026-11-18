const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'utils', 'envUpdater.js');

let sandbox;
let envUpdater;

const envPath = (pathType) => (pathType === 'root' ? path.join(sandbox, '.env') : path.join(sandbox, pathType, '.env'));
const seed = (pathType, text) => {
    fs.mkdirSync(path.dirname(envPath(pathType)), { recursive: true });
    fs.writeFileSync(envPath(pathType), text, 'utf8');
};
const read = (pathType) => fs.readFileSync(envPath(pathType), 'utf8');

beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'env-updater-'));
    fs.mkdirSync(path.join(sandbox, 'utils'));
    fs.copyFileSync(SOURCE, path.join(sandbox, 'utils', 'envUpdater.js'));
    envUpdater = require(path.join(sandbox, 'utils', 'envUpdater.js'));
});

afterEach(() => {
    jest.resetModules();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('updateEnvVariablesUtil', () => {
    it('replaces an existing variable in place, quoting the new value, and keeps the other lines', async () => {
        seed('root', '# keep\nA=1\nB=2\nC=3\n');
        const message = await envUpdater.updateEnvVariablesUtil('root', [{ variableName: 'B', variableValue: 'two' }]);
        expect(message).toBe('Updated 1 variable(s) in root/.env');
        expect(read('root')).toBe('# keep\nA=1\nB="two"\nC=3\n');
    });

    it('appends a variable that is not there yet', async () => {
        seed('root', 'A=1\n');
        await envUpdater.updateEnvVariablesUtil('root', [{ variableName: 'NEW', variableValue: 'x' }]);
        expect(read('root')).toBe('A=1\nNEW="x"\n');
    });

    it('updates several variables in one call, replacing some and appending others', async () => {
        seed('root', 'A=1\nB=2\n');
        const message = await envUpdater.updateEnvVariablesUtil('root', [
            { variableName: 'A', variableValue: 'one' },
            { variableName: 'C', variableValue: 'three' },
        ]);
        expect(message).toBe('Updated 2 variable(s) in root/.env');
        expect(read('root')).toBe('A="one"\nB=2\nC="three"\n');
    });

    it.failing('bug: a value containing $1 or $& is mangled by String.replace, corrupting the stored secret', async () => {
        seed('root', 'URL=old\n');
        await envUpdater.updateEnvVariablesUtil('root', [{ variableName: 'URL', variableValue: 'mongodb://u:p$1@h/db?a=b' }]);
        expect(read('root')).toBe('URL="mongodb://u:p$1@h/db?a=b"\n');
    });

    it('updates the frontend file and not the root file', async () => {
        seed('root', 'A=1\n');
        seed('frontend', 'VUE_APP_X=1\n');
        const message = await envUpdater.updateEnvVariablesUtil('frontend', [{ variableName: 'VUE_APP_X', variableValue: '2' }]);
        expect(message).toBe('Updated 1 variable(s) in frontend/.env');
        expect(read('frontend')).toBe('VUE_APP_X="2"\n');
        expect(read('root')).toBe('A=1\n');
    });

    it('updates the admin file and not the others', async () => {
        seed('admin', 'K=1\n');
        seed('frontend', 'K=1\n');
        await envUpdater.updateEnvVariablesUtil('admin', [{ variableName: 'K', variableValue: '9' }]);
        expect(read('admin')).toBe('K="9"\n');
        expect(read('frontend')).toBe('K=1\n');
    });

    it('does not change a variable whose name only ends with the requested name', async () => {
        seed('root', 'MY_KEY=1\nKEY=2\n');
        await envUpdater.updateEnvVariablesUtil('root', [{ variableName: 'KEY', variableValue: 'x' }]);
        expect(read('root')).toBe('MY_KEY=1\nKEY="x"\n');
    });

    it('adds to an empty file', async () => {
        seed('root', '');
        await envUpdater.updateEnvVariablesUtil('root', [{ variableName: 'A', variableValue: '1' }]);
        expect(read('root').trim()).toBe('A="1"');
    });

    it.each([['other'], ['../x'], [''], [undefined], [null], ['ROOT']])('refuses the path type %p and writes nothing', async (pathType) => {
        seed('root', 'A=1\n');
        await expect(envUpdater.updateEnvVariablesUtil(pathType, [{ variableName: 'A', variableValue: '2' }]))
            .rejects.toThrow("Invalid pathType. Use 'root', 'frontend', or 'admin'.");
        expect(read('root')).toBe('A=1\n');
    });

    it.each([[undefined], [null], [[]], ['A=1'], [{ variableName: 'A' }]])('refuses the variables %p', async (variables) => {
        seed('root', 'A=1\n');
        await expect(envUpdater.updateEnvVariablesUtil('root', variables)).rejects.toThrow('variables must be a non-empty array.');
        expect(read('root')).toBe('A=1\n');
    });

    it('rejects with the read error when the file does not exist', async () => {
        await expect(envUpdater.updateEnvVariablesUtil('admin', [{ variableName: 'A', variableValue: '1' }]))
            .rejects.toThrow(/^Error reading admin \.env file: /);
        expect(fs.existsSync(envPath('admin'))).toBe(false);
    });

    it('rejects with the write error when the file cannot be written', async () => {
        seed('root', 'A=1\n');
        const spy = jest.spyOn(fs, 'writeFile').mockImplementation((file, data, enc, cb) => cb(new Error('disk full')));
        await expect(envUpdater.updateEnvVariablesUtil('root', [{ variableName: 'A', variableValue: '2' }]))
            .rejects.toThrow('Error writing root .env file: disk full');
        spy.mockRestore();
        expect(read('root')).toBe('A=1\n');
    });
});

describe('getEnvVariablesUtil', () => {
    it('reads every variable of the chosen file', async () => {
        seed('frontend', 'A=1\nB=two\n');
        expect(await envUpdater.getEnvVariablesUtil('frontend')).toEqual({ A: '1', B: 'two' });
    });

    it('strips matching double or single quotes and keeps mismatched ones', async () => {
        seed('root', 'A="x y"\nB=\'z\'\nC="half\nD=\'mixed"\n');
        expect(await envUpdater.getEnvVariablesUtil('root')).toEqual({ A: 'x y', B: 'z', C: '"half', D: '\'mixed"' });
    });

    it('keeps equals signs inside a value', async () => {
        seed('root', 'URL=mongodb://h/db?a=b&c=d\n');
        expect(await envUpdater.getEnvVariablesUtil('root')).toEqual({ URL: 'mongodb://h/db?a=b&c=d' });
    });

    it('skips blank lines and comments and trims whitespace', async () => {
        seed('root', '\n# comment\n   \n  A=1  \n');
        expect(await envUpdater.getEnvVariablesUtil('root')).toEqual({ A: '1' });
    });

    it('skips a line with no name', async () => {
        seed('root', '=orphan\nA=1\n');
        expect(await envUpdater.getEnvVariablesUtil('root')).toEqual({ A: '1' });
    });

    it('reads an empty value as an empty string and an empty file as no variables', async () => {
        seed('root', 'A=\n');
        expect(await envUpdater.getEnvVariablesUtil('root')).toEqual({ A: '' });
        seed('admin', '');
        expect(await envUpdater.getEnvVariablesUtil('admin')).toEqual({});
    });

    it('reads Windows line endings without a trailing carriage return in values', async () => {
        seed('root', 'A=1\r\nB="2"\r\n');
        expect(await envUpdater.getEnvVariablesUtil('root')).toEqual({ A: '1', B: '2' });
    });

    it('reads back what updateEnvVariablesUtil wrote', async () => {
        seed('root', 'A=1\n');
        await envUpdater.updateEnvVariablesUtil('root', [{ variableName: 'A', variableValue: 'new value' }, { variableName: 'B', variableValue: 'b=c' }]);
        expect(await envUpdater.getEnvVariablesUtil('root')).toEqual({ A: 'new value', B: 'b=c' });
    });

    it.each([['other'], [''], [undefined], ['../x']])('refuses the path type %p', async (pathType) => {
        await expect(envUpdater.getEnvVariablesUtil(pathType)).rejects.toThrow("Invalid pathType. Use 'root', 'frontend', or 'admin'.");
    });

    it('rejects with the read error when the file does not exist', async () => {
        await expect(envUpdater.getEnvVariablesUtil('frontend')).rejects.toThrow(/^Error reading frontend \.env file: /);
    });
});
