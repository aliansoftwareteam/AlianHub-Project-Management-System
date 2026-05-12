/**
 * BUG-036 regression — `process.env.SERVICE_FILE` path traversal.
 *
 * Pre-fix: `Modules/checkinstallstep/controller.js` did
 *   require("../" + process.env.SERVICE_FILE)
 * letting an installer-wizard input (or anything else that influences
 * the env) load arbitrary JS/JSON inside the repo.
 *
 * Post-fix: a shared `resolveServiceFile()` helper:
 *   * rejects absolute paths,
 *   * rejects paths that resolve outside the project root,
 *   * requires `.json` extension,
 *   * requires the file to exist.
 *
 * We can't easily mock `require()`, so we exercise the helper directly.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function assert(cond, label) {
    if (!cond) {
        console.error('FAIL:', label);
        process.exit(1);
    }
    console.log('PASS:', label);
}

const { resolveServiceFile } = require(path.resolve(ROOT, 'utils/safeServiceFile.js'));

// Set up a dummy valid file at <root>/test-bug-036-fixture.json.
const goodPath = path.resolve(ROOT, 'test-bug-036-fixture.json');
fs.writeFileSync(goodPath, '{"projectId":"x"}');

try {
    // ---- 1. valid relative .json file inside root → returns absolute path ----
    const resolved = resolveServiceFile('test-bug-036-fixture.json');
    assert(resolved === goodPath, 'returns absolute path for valid relative .json file inside root');

    // ---- 2. empty / missing input → throws ----
    let threw = false;
    try { resolveServiceFile(''); } catch (e) { threw = /not set|empty/.test(e.message); }
    assert(threw, 'rejects empty SERVICE_FILE');

    threw = false;
    try { resolveServiceFile(undefined); } catch (e) { threw = /not set|empty/.test(e.message); }
    assert(threw, 'rejects undefined SERVICE_FILE');

    // ---- 3. path traversal escape attempt → throws ----
    threw = false;
    try { resolveServiceFile('../../../../etc/passwd'); } catch (e) { threw = /outside|\.json/.test(e.message); }
    assert(threw, 'rejects path-traversal escape (../../../../etc/passwd)');

    // ---- 4. absolute path → throws ----
    threw = false;
    try { resolveServiceFile('/etc/hosts'); } catch (e) { threw = /relative/.test(e.message); }
    assert(threw, 'rejects absolute paths');

    // On Windows, absolute paths use a different syntax — assert that too.
    threw = false;
    try { resolveServiceFile('C:\\Windows\\System32\\drivers\\etc\\hosts'); } catch (e) { threw = /relative/.test(e.message); }
    assert(threw, 'rejects Windows-style absolute paths');

    // ---- 5. non-.json extension → throws even if file exists ----
    const jsPath = path.resolve(ROOT, 'test-bug-036-fixture.js');
    fs.writeFileSync(jsPath, '// inert');
    threw = false;
    try { resolveServiceFile('test-bug-036-fixture.js'); } catch (e) { threw = /\.json/.test(e.message); }
    fs.unlinkSync(jsPath);
    assert(threw, 'rejects non-.json extensions');

    // ---- 6. missing file → throws ----
    threw = false;
    try { resolveServiceFile('nonexistent-file-bug-036.json'); } catch (e) { threw = /not found/.test(e.message); }
    assert(threw, 'rejects missing file');

    // ---- 7. wired in installer + firebase config ----
    const checkinstallSrc = fs.readFileSync(path.resolve(ROOT, 'Modules/checkinstallstep/controller.js'), 'utf8');
    assert(/resolveServiceFile\(process\.env\.SERVICE_FILE\)/.test(checkinstallSrc), 'installer controller uses resolveServiceFile()');
    // Strip line-comments before scanning so the BUG-036 comment block
    // describing the OLD pattern doesn't false-positive the assertion.
    const codeOnly = checkinstallSrc.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert(!/require\(\s*["']\.\.\/["']\s*\+\s*process\.env\.SERVICE_FILE\s*\)/.test(codeOnly), 'installer no longer uses the unsafe require concat');

    const fbSrc = fs.readFileSync(path.resolve(ROOT, 'Config/firebaseConfig.js'), 'utf8');
    assert(/resolveServiceFile\(/.test(fbSrc), 'firebaseConfig uses resolveServiceFile()');

    console.log('\nAll BUG-036 assertions passed.');
} finally {
    try { fs.unlinkSync(goodPath); } catch (_) {}
}
