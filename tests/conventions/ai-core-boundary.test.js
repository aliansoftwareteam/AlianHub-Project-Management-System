const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCAN = ['Modules', 'Config', 'utils', 'middlewares', 'event', 'common-storage'];
const CORE = path.join('Modules', 'AICore') + path.sep;

/* Every model call goes through Modules/AICore/llmProvider so pricing, usage
 * accounting, the instruction guard and provider selection cannot be bypassed.
 * A direct vendor call elsewhere was how ProjectTemplates ended up billing
 * against a hard-coded OpenAI endpoint that no budget could see. */
const VENDOR_SDK = /require\(\s*['"](openai|@anthropic-ai\/sdk|@google\/generative-ai)['"]\s*\)/;
const VENDOR_HOST = /https:\/\/(api\.openai\.com|api\.anthropic\.com|api\.deepseek\.com|generativelanguage\.googleapis\.com)/;

/* Not chat completions, so the factory has nothing to offer them yet. Each
 * entry is a follow-up of task 024, not a permanent exception. */
const ALLOWED_OUTSIDE_CORE = [
    'Modules/AI/transcribe.js',
    'Modules/Instance/probes.js',
];

const glob = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (f === 'node_modules') continue;
        if (fs.statSync(p).isDirectory()) glob(p, out);
        else if (f.endsWith('.js')) out.push(p);
    }
    return out;
};

describe('vendor LLM SDKs and hosts are only reached from Modules/AICore', () => {
    const files = SCAN.flatMap((d) => glob(path.join(ROOT, d))).map((f) => path.relative(ROOT, f));
    const offenders = files.filter((rel) => {
        if (rel.startsWith(CORE) || ALLOWED_OUTSIDE_CORE.includes(rel)) return false;
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        return VENDOR_SDK.test(text) || VENDOR_HOST.test(text);
    });

    it('scans the modules (the scan works)', () => { expect(files.length).toBeGreaterThan(100); });
    it('the core itself talks to a vendor (the patterns work)', () => {
        const core = files.filter((rel) => rel.startsWith(CORE)).map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
        expect(core.some((t) => VENDOR_SDK.test(t) || VENDOR_HOST.test(t))).toBe(true);
    });
    it('finds no direct vendor call outside the core', () => { expect(offenders).toEqual([]); });
    it('keeps the allowlist honest', () => {
        for (const rel of ALLOWED_OUTSIDE_CORE) {
            const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            expect(VENDOR_SDK.test(text) || VENDOR_HOST.test(text)).toBe(true);
        }
    });
});
