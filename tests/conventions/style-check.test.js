/* Gate for scripts/style-check.js: colours come from the tokens in
   frontend/src/assets/css/tokens.css, so the hard-coded colours and legacy
   utility classes each file still carries are a per-file baseline
   (scripts/style-baseline.json) that may only shrink. */
const fs = require('fs');
const {
    cssFindings, vueFindings, legacyClassesIn, legacyClassSet, scanTree, readBaseline,
    compareToBaseline, nextBaseline, formatBaseline, describeDrift, BASELINE
} = require('../../scripts/style-check');

const values = (findings, kind) => findings.filter((f) => !kind || f.kind === kind).map((f) => f.value);

describe('the colour scanner', () => {
    test('counts hex, rgb/hsl literals and named colours in declarations', () => {
        const findings = cssFindings(`
            .a { color: #FFF; background: #2f3990; border: 1px solid rgba(0, 0, 0, .1); }
            .b { box-shadow: 0 0 2px #00000080, 0 1px hsl(210 10% 20%); color: white; background-color: Black }
            .c { --local: #abcd; outline-color: red !important }
        `);
        expect(values(findings)).toEqual(['#FFF', '#2f3990', 'rgba(0, 0, 0, .1)', '#00000080', 'hsl(210 10% 20%)', 'white', 'Black', '#abcd', 'red']);
        expect(findings.map((f) => f.line)).toEqual([2, 2, 2, 3, 3, 3, 3, 4, 4]);
    });

    test('ignores selectors, comments, url(), strings, tokens and var() fallbacks', () => {
        expect(cssFindings(`
            #fff .black, a.white:hover, #add:not(#bad) { color: var(--ink); background: var(--surface, #fff); white-space: nowrap; }
            /* .old { color: #000; } */
            .c { background: url("data:image/svg+xml,<svg fill='#fff'/>"); fill: url(#fade); content: "#000 black"; }
            .d { color: rgba(var(--brand-rgb), .5); border-color: currentColor; background: transparent; box-shadow: 0 0 0 var(--ring, rgba(0, 0, 0, .2)); }
        `)).toEqual([]);
    });

    test('a colour name counts only where a colour is expected', () => {
        expect(values(cssFindings('.a { font-family: Tan, Linen; animation: snow 1s; transition: background-color .2s; border: 1px solid tan; }'))).toEqual(['tan']);
    });

    test('// starts a comment in scss but not in css', () => {
        const source = '.a { color: #111; }\n// .b { color: #222; }\n.c { &:hover { color: darken(#333, 10%); } }';
        expect(values(cssFindings(source, { lineComments: true }))).toEqual(['#111', '#333']);
    });
});

describe('the single-file component scanner', () => {
    const legacy = new Set(['bg-white', 'GunPowder', 'blue', 'black', 'font-size-13']);
    const findings = vueFindings([
        '<template>',
        '    <!-- <p style="color: #000" class="bg-white"></p> -->',
        '    <div class="bg-white box  GunPowder" style="color: #333; background: white"',
        '        :style="{ color: active ? \'#fff\' : \'black\', borderColor: tone, width: w > 3 ? \'1px\' : `rgb(0,0,0)`, fill: \'var(--ink, #999)\' }">',
        '        <svg><path fill="#2F3990" stroke="black" /></svg>',
        '        <span :class="[open ? \'blue font-size-13\' : \'ah-muted\', { black: dark, \'bg-white\': light, plain: black }, kind === \'blue\' && \'x\']">{{ a < b ? \'#fff\' : \'\' }}</span>',
        '        <b v-bind:class="`GunPowder size-${n}`" data-class="blue" content-style="color: #000"></b>',
        '    </div>',
        '</template>',
        '<script>',
        'export default { data: () => ({ tone: \'#abcdef\', cls: \'bg-white\' }) };',
        '</script>',
        '<style scoped>',
        '.x { color: #123456; }',
        '</style>',
        '<style lang="scss">',
        '// .y { color: #000; }',
        '.z { &:hover { color: #abc; } }',
        '</style>'
    ].join('\n'), legacy);

    test('counts colours in style and :style attributes and in every style block', () => {
        expect(values(findings, 'colour')).toEqual(['#333', 'white', '#fff', 'black', 'rgb(0,0,0)', '#123456', '#abc']);
    });

    test('counts legacy classes in class and :class, as strings or object keys', () => {
        expect(values(findings, 'legacy')).toEqual(['bg-white', 'GunPowder', 'blue', 'font-size-13', 'black', 'bg-white', 'GunPowder']);
    });

    test('reports the line of each finding', () => {
        expect(findings.filter((f) => f.kind === 'legacy').map((f) => f.line)).toEqual([3, 3, 6, 6, 6, 6, 7]);
        expect(findings.find((f) => f.value === '#123456').line).toBe(14);
    });

    test('leaves script, svg attributes, comments and other attributes alone', () => {
        const all = values(findings);
        ['#abcdef', '#2F3990', '#000', '#999'].forEach((value) => expect(all).not.toContain(value));
    });
});

describe('the legacy class list', () => {
    test('is every single-class rule that hard-codes a colour or a font value', () => {
        expect(legacyClassesIn(`
            .bg-white { background-color: #FFFFFF !important; }
            .GunPowder{ color : #535358; }
            .hover-bg-blue:hover { background-color: #2F3990 !important; }
            .form-control::placeholder { color: #818181; }
            .font-size-13 { font-size: 13px; }
            .btn-white, .btn-light { background: white; }
            @media (max-width: 767px) { .mobile-label-font { line-height: 21px !important; } }
            .font-ui { font-family: var(--font-ui); }
            .themed { color: var(--ink); font: var(--text-body); }
            .d-flex { display: flex; }
            .card .title { color: #000; }
            .a.b { color: #000; }
        `)).toEqual(['GunPowder', 'bg-white', 'btn-light', 'btn-white', 'font-size-13', 'form-control', 'hover-bg-blue', 'mobile-label-font']);
    });

    test('is read from the legacy stylesheets, not from the token sheet', () => {
        const legacy = legacyClassSet();
        ['bg-white', 'bg-light-gray', 'GunPowder', 'btn-white', 'color47', 'blue', 'black', 'font-size-13'].forEach((name) => expect(legacy.has(name)).toBe(true));
        ['d-flex', 'ah-btn', 'ah-card', 'ah-muted'].forEach((name) => expect(legacy.has(name)).toBe(false));
    });
});

describe('the baseline rules', () => {
    const baseline = { files: {
        'a.vue': { colours: 4, legacyClasses: 2 },
        'b.css': { colours: 3, legacyClasses: 0 },
        'gone.vue': { colours: 1, legacyClasses: 1 }
    } };
    const scan = {
        'a.vue': { colours: 5, legacyClasses: 1 },
        'b.css': { colours: 3, legacyClasses: 0 },
        'new.vue': { colours: 0, legacyClasses: 2 }
    };

    test('a count above the baseline, or any count in a file without one, is over', () => {
        expect(compareToBaseline(scan, baseline).over).toEqual([
            { file: 'a.vue', kind: 'colours', found: 5, allowed: 4 },
            { file: 'new.vue', kind: 'legacyClasses', found: 2, allowed: 0 }
        ]);
    });

    test('a baseline above the real count is stale', () => {
        expect(compareToBaseline(scan, baseline).stale).toEqual([
            { file: 'a.vue', kind: 'legacyClasses', found: 1, allowed: 2 },
            { file: 'gone.vue', kind: 'colours', found: 0, allowed: 1 },
            { file: 'gone.vue', kind: 'legacyClasses', found: 0, allowed: 1 }
        ]);
    });

    test('a failure names the file, both counts and the command to run', () => {
        const { over, stale } = compareToBaseline(scan, baseline);
        expect(describeDrift(over, stale)).toEqual(expect.stringContaining('a.vue: 5 hard-coded colours, baseline 4'));
        expect(describeDrift(over, stale)).toEqual(expect.stringContaining('new.vue: 2 legacy classes, baseline 0'));
        expect(describeDrift(over, stale)).toEqual(expect.stringContaining('npm run style:check -- a.vue'));
        expect(describeDrift(over, stale)).toEqual(expect.stringContaining('gone.vue: 0 hard-coded colours, baseline 1'));
        expect(describeDrift(over, stale)).toEqual(expect.stringContaining('npm run style:baseline'));
        expect(describeDrift([], [])).toBe('');
    });

    test('rewriting only lowers: it drops what is gone and refuses what grew', () => {
        const next = nextBaseline(scan, baseline);
        expect(next.files).toEqual({
            'a.vue': { colours: 4, legacyClasses: 1 },
            'b.css': { colours: 3, legacyClasses: 0 }
        });
        expect(next.refused).toEqual(compareToBaseline(scan, baseline).over);
    });

    test('rewriting raises a count only when asked to', () => {
        const next = nextBaseline(scan, baseline, { allowIncrease: true });
        expect(next.files).toEqual(scan);
        expect(next.refused).toEqual([]);
    });

    test('the file is one sorted line per source file, with nothing that changes between runs', () => {
        const text = formatBaseline({ 'b.css': { legacyClasses: 0, colours: 3 }, 'a.vue': { colours: 4, legacyClasses: 1 } });
        expect(text).toBe('{\n  "files": {\n    "a.vue": { "colours": 4, "legacyClasses": 1 },\n    "b.css": { "colours": 3, "legacyClasses": 0 }\n  }\n}\n');
        expect(JSON.parse(text).files['a.vue']).toEqual({ colours: 4, legacyClasses: 1 });
        expect(formatBaseline({})).toBe('{\n  "files": {}\n}\n');
    });
});

describe('frontend/src against scripts/style-baseline.json', () => {
    const { over, stale } = compareToBaseline(scanTree(), readBaseline());

    test('no file has more hard-coded colours or legacy classes than its baseline', () => {
        if (over.length) throw new Error(describeDrift(over, []));
    });

    test('no baseline entry is higher than the file now needs', () => {
        if (stale.length) throw new Error(describeDrift([], stale));
    });

    test('the baseline file is in the form style:baseline writes', () => {
        expect(fs.readFileSync(BASELINE, 'utf8')).toBe(formatBaseline(readBaseline().files));
    });
});
