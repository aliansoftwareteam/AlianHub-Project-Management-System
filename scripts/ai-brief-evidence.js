#!/usr/bin/env node
/**
 * Evidence gate for task 015 section E: runs coverage → clarify (both
 * rounds, answering "I don't know yet" to everything) → brief against the
 * configured LLM provider for three thin briefs from three domains, and
 * prints the full transcript as markdown.
 *
 *   node scripts/ai-brief-evidence.js [--env /path/to/.env] [--out evidence.md]
 *
 * The provider and key come from the .env the app itself uses; nothing is
 * faked. Without a configured provider the script says so and exits 1.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
};

require('dotenv').config({ path: flag('--env') || path.join(ROOT, '.env') });

const { isAnyProviderConfigured } = require(path.join(ROOT, 'Modules/AIProjectGenerator/llmProvider'));
const clarifier = require(path.join(ROOT, 'Modules/AIProjectGenerator/clarifier'));
const { COVERAGE_POINTS } = require(path.join(ROOT, 'Modules/AIProjectGenerator/schemaValidator'));

const BRIEFS = [
    {
        name: 'Online store',
        description: 'An online store for our handmade ceramics.\nWe sell at markets today and want to sell online too.',
    },
    {
        name: 'Mobile app',
        description: 'A mobile app for booking padel courts at our two clubs.\nMembers should be able to book and pay in the app.',
    },
    {
        name: 'Multi-team system (ERP rollout)',
        description: 'Roll out a new ERP across Finance, Warehouse and Sales, replacing the spreadsheets each team runs today.\nEverything has to line up at month end.',
    },
];

const out = [];
const line = (s = '') => out.push(s);
const money = (usage) => (usage && usage.priced ? `$${usage.costUsd.toFixed(4)}` : 'n/a');

function coverageTable(coverage, notes) {
    line('| Point | Verdict | Reviewer note |');
    line('|---|---|---|');
    for (const p of COVERAGE_POINTS) {
        line(`| \`${p}\` | ${coverage[p]} | ${(notes && notes[p]) || ''} |`);
    }
    line();
}

function questionBlock(q, i) {
    line(`${i + 1}. **${q.question}**  \n   point: \`${q.point}\` · type: \`${q.type}\` · category: \`${q.category}\` · allowUnknown: ${q.allowUnknown}`);
    if (Array.isArray(q.options)) {
        for (const o of q.options) {
            const rec = Array.isArray(q.recommended) ? q.recommended.includes(o.value) : q.recommended === o.value;
            line(`   - ${rec ? '**' : ''}${o.label}${rec ? '** (recommended)' : ''}${o.description ? ` — ${o.description}` : ''}`);
        }
    } else if (q.recommended !== undefined) {
        line(`   - recommended: ${JSON.stringify(q.recommended)}`);
    }
    if (q.hint) line(`   - hint: ${q.hint}`);
    if (q.rationale) line(`   - rationale: ${q.rationale}`);
}

function usageLine(label, r) {
    line(`_${label}: ${r.provider}/${r.model}, ${r.usage.inputTokens} in + ${r.usage.outputTokens} out tokens, ${money(r.usage)}_`);
    line();
}

async function runBrief(brief) {
    line(`## ${brief.name}`);
    line();
    line('**Brief as typed:**');
    line();
    line('```');
    line(brief.description);
    line('```');
    line();

    const answers = [];
    for (let round = 1; round <= clarifier.MAX_ROUNDS; round += 1) {
        const r = await clarifier.generateClarifyingQuestions({ description: brief.description, previousAnswers: answers, round });
        line(`### Round ${r.round} of ${r.maxRounds}`);
        line();
        coverageTable(r.coverage, r.notes);
        if (r.understanding) line(`> ${r.understanding}\n`);
        if (!r.questions.length) {
            line('_No questions: every point still missing was already asked (and left unknown), or every point is met._');
            line();
            usageLine('Usage', r);
            continue;
        }
        r.questions.forEach(questionBlock);
        line();
        usageLine('Usage', r);
        for (const q of r.questions) {
            answers.push({ id: q.id, point: q.point, question: q.question, answer: null, unknown: true });
        }
        line(`_Answered "I don't know yet" to all ${r.questions.length}._`);
        line();
    }

    const b = await clarifier.draftBrief({ description: brief.description, answers });
    line('### Brief draft (all answers unknown)');
    line();
    coverageTable(b.coverage, b.notes);
    line('```markdown');
    line(b.brief.markdown.trim());
    line('```');
    line();
    usageLine('Usage', b);
    line(`Questions asked in total: **${answers.length}** (cap ${clarifier.MAX_TOTAL_QUESTIONS}). Assumptions stated: **${b.brief.assumptions.length}**.`);
    line();
}

async function main() {
    if (!isAnyProviderConfigured()) {
        process.stderr.write('No LLM provider is configured in the .env given; nothing to run.\n');
        process.exit(1);
    }
    line('# 015 evidence — coverage, clarify and brief on three thin briefs');
    line();
    line(`Generated ${new Date().toISOString()} by \`scripts/ai-brief-evidence.js\` against the configured provider. Every question was answered "I don't know yet" so the transcript shows both rounds and the assumptions the brief states in their place.`);
    line();
    for (const brief of BRIEFS) {
        try {
            await runBrief(brief);
        } catch (error) {
            line(`**Failed:** ${error && error.message ? error.message : error}`);
            line();
        }
    }
    const text = out.join('\n');
    const dest = flag('--out');
    if (dest) {
        fs.writeFileSync(dest, text);
        process.stderr.write(`Wrote ${dest}\n`);
    } else {
        process.stdout.write(text);
    }
}

main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
});
