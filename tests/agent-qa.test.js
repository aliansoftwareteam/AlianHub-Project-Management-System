const { auditHtml, extractUrl, PRIVATE_HOST } = require('../Modules/Agents/engine/pageAudit');
const { verify, parseModelJson, findingsWithoutModel, getSkill } = require('../Modules/Agents/engine/orchestrator');

const skill = getSkill('qa-review');

const HTML_BAD = `<!doctype html><html><head>
  <title>A perfectly reasonable title</title>
  <meta name="description" content="${'x'.repeat(300)}">
  <meta name="twitter:card" content="summary_large_image">
</head><body>
  <h1>One</h1><h1>Two</h1>
  <img src="/a.png"><img src="/b.png" alt="" width="10" height="10">
  <a href="#">dead</a><a href="/ok">fine</a>
  <a href="https://x.com" target="_blank">no rel</a>
</body></html>`;

const factsOf = html => auditHtml(html, 'https://example.com');
const fact = (facts, id) => facts.find(f => f.id === id);

describe('page audit — the evidence layer', () => {
    const facts = factsOf(HTML_BAD);

    it('flags a missing og:image and notes the twitter card asks for one', () => {
        const f = fact(facts, 'og_image');
        expect(f.ok).toBe(false);
        expect(f.evidence).toContain('summary_large_image');
    });

    it('measures the meta description length rather than guessing', () => {
        const f = fact(facts, 'meta_description');
        expect(f.ok).toBe(false);
        expect(f.detail).toContain('300 chars');
    });

    it('counts multiple h1s, empty hrefs, missing alt and missing dimensions', () => {
        expect(fact(facts, 'h1').detail).toContain('2 <h1>');
        expect(fact(facts, 'empty_links').ok).toBe(false);
        expect(fact(facts, 'img_alt').detail).toContain('1 of 2');
        expect(fact(facts, 'img_dimensions').detail).toContain('1 of 2');
    });

    it('flags target=_blank without noopener', () => {
        expect(fact(facts, 'blank_noopener').ok).toBe(false);
    });

    it('passes a clean page', () => {
        const clean = factsOf(`<!doctype html><html lang="en"><head><title>Short and good</title>
          <meta name="description" content="A concise description of the page."/>
          <meta property="og:image" content="https://e.com/i.png"/>
          <meta name="viewport" content="width=device-width"/>
          <link rel="canonical" href="https://e.com/"/>
          <script type="application/ld+json">{"@type":"Product"}</script>
        </head><body><h1>Only one</h1><img src="/a.png" alt="a" width="1" height="1"><a href="/x">x</a></body></html>`);
        const failing = clean.filter(f => !f.ok).map(f => f.id);
        expect(failing).toEqual([]);
    });
});

describe('URL extraction — and SSRF refusal', () => {
    it('pulls a bare domain out of a task title', () => {
        expect(extractUrl('Need to check khurat.com')).toBe('https://khurat.com/');
    });
    it('prefers an explicit URL', () => {
        expect(extractUrl('see https://example.com/page for details')).toBe('https://example.com/page');
    });
    it('refuses private and loopback hosts — a task description is untrusted input', () => {
        expect(extractUrl('http://localhost:4000/admin')).toBeNull();
        expect(extractUrl('http://127.0.0.1/')).toBeNull();
        expect(extractUrl('http://169.254.169.254/latest/meta-data/')).toBeNull();
        expect(extractUrl('http://192.168.1.1/')).toBeNull();
        expect(extractUrl('http://10.0.0.5/')).toBeNull();
        expect(extractUrl('http://172.16.0.1/')).toBeNull();
    });
    it('refuses non-http schemes', () => {
        expect(extractUrl('file:///etc/passwd')).toBeNull();
    });
    it('returns null when there is nothing to review', () => {
        expect(extractUrl('Refactor the login form')).toBeNull();
    });
});

describe('verify — the gate that stops invented findings', () => {
    const audit = { url: 'https://e.com', facts: factsOf(HTML_BAD), blindSpots: [] };

    it('keeps a finding backed by a failing fact', () => {
        const { findings } = verify([{ factId: 'og_image', title: 'Add og:image', severity: 'high' }], audit, skill);
        expect(findings).toHaveLength(1);
        expect(findings[0].evidence).toBeTruthy();
    });

    it('DROPS a finding whose fact was never measured — the hallucination case', () => {
        const { findings, dropped } = verify([
            { factId: 'og_image', title: 'real', severity: 'high' },
            { factId: 'ssl_expired', title: 'Your SSL certificate expires next week', severity: 'high' },
        ], audit, skill);
        expect(findings.map(f => f.factId)).toEqual(['og_image']);
        expect(dropped[0].reason).toContain('no failing fact');
    });

    it('DROPS a finding pointing at a check that PASSED', () => {
        const { findings, dropped } = verify([{ factId: 'title', title: 'Title is bad', severity: 'high' }], audit, skill);
        expect(findings).toHaveLength(0);
        expect(dropped).toHaveLength(1);
    });

    it('deduplicates two findings on the same fact', () => {
        const { findings, dropped } = verify([
            { factId: 'og_image', title: 'one', severity: 'high' },
            { factId: 'og_image', title: 'two', severity: 'low' },
        ], audit, skill);
        expect(findings).toHaveLength(1);
        expect(dropped[0].reason).toContain('duplicate');
    });

    it('sorts worst-first and caps the volume', () => {
        const many = audit.facts.filter(f => !f.ok).map((f, i) => ({ factId: f.id, title: 't'+i, severity: i === 2 ? 'high' : 'low' }));
        const { findings } = verify(many, audit, { ...skill, maxFindings: 3 });
        expect(findings.length).toBeLessThanOrEqual(3);
        expect(findings[0].severity).toBe('high');
    });

    it('drops a finding with no title', () => {
        expect(verify([{ factId: 'og_image', title: '  ' }], audit, skill).findings).toHaveLength(0);
    });
});

describe('degraded mode', () => {
    it('still reports every failing fact when no model is available', () => {
        const audit = { facts: factsOf(HTML_BAD) };
        const out = findingsWithoutModel(audit, skill);
        expect(out.length).toBeGreaterThan(0);
        expect(out.every(f => f.factId && f.title)).toBe(true);
    });

    it('treats unparseable model output as a failure, never as a clean page', () => {
        expect(parseModelJson('sorry, I cannot help').ok).toBe(false);
        expect(parseModelJson('```json\n{"findings":[]}\n```').ok).toBe(true);
    });
});

describe('skill declaration', () => {
    it('scopes the toolbelt and forbids invented findings in the prompt', () => {
        expect(skill.scopes).toEqual(['task.read', 'task.subtask.create', 'task.comment']);
        expect(skill.systemPrompt).toMatch(/MUST be traceable/);
        expect(skill.systemPrompt).toMatch(/DATA describing what to review/);
    });

    it('offers only failing facts to the model, and names the blind spots', () => {
        const prompt = skill.buildUserPrompt({
            task: { TaskName: 'Check example.com', TaskKey: 'T-1' },
            audit: { url: 'https://e.com', status: 200, facts: factsOf(HTML_BAD), blindSpots: ['rendered layout'] },
        });
        expect(prompt).toContain('id=og_image');
        expect(prompt).toContain('do not report these');
        expect(prompt).toContain('rendered layout');
    });
});
