const vm = require('vm');

// Phrases that read as instructions to the model rather than facts about the
// project. Deliberately short and generic: the prompts do the real work, this
// only guarantees a person sees a note when one slipped in, and that memory
// never stores one. The instance owner can add patterns on top of these
// (Modules/AICore/instructionPatterns.js); these stay whatever is added.
const INSTRUCTION_PATTERNS = [
    /ignore (?:all |any |the |every )?(?:previous|prior|above|earlier|preceding) (?:instructions?|rules?|prompts?|guidance)/i,
    /disregard (?:all |any |the |every )?(?:previous|prior|above|earlier|preceding) (?:instructions?|rules?|prompts?)/i,
    /(?:do not|don't|never) follow (?:the |your |any )?(?:rules|instructions|system prompt)/i,
    /\bsystem prompt\b/i,
    /\byou are now\b/i,
    /\bfrom now on,? (?:you|act|respond|answer)\b/i,
    /reveal (?:your|the) (?:instructions|prompt|rules)/i,
];

// Added patterns are checked for shape when saved, but V8 cannot interrupt a
// regular expression on the main thread; a vm timeout can, so a pattern that
// slips past the shape rules costs this long at most, not the event loop.
const MATCH_TIMEOUT_MS = 25;

const sandbox = vm.createContext({ re: null, text: '' });
const execInSandbox = new vm.Script('(() => { const m = re.exec(text); return m ? [m.index, m[0].length] : null; })()');

const store = () => require('./instructionPatterns');

function boundedMatch(entry, text) {
    sandbox.re = entry.re;
    sandbox.text = text;
    try {
        const hit = execInSandbox.runInContext(sandbox, { timeout: MATCH_TIMEOUT_MS });
        return hit ? { index: hit[0], length: hit[1] } : null;
    } catch (error) {
        require('../../Config/loggerConfig').error(`instruction guard: added pattern ${entry.id} timed out after ${MATCH_TIMEOUT_MS}ms and was skipped for this text`);
        return null;
    } finally {
        sandbox.re = null;
        sandbox.text = '';
    }
}

function firstMatch(text) {
    for (const pattern of INSTRUCTION_PATTERNS) {
        const match = pattern.exec(text);
        if (match) return { index: match.index, length: match[0].length };
    }
    for (const entry of store().current()) {
        const match = boundedMatch(entry, text);
        if (match) return match;
    }
    return null;
}

function excerpt(text) {
    const value = String(text || '');
    const match = firstMatch(value);
    if (!match) return null;
    const start = Math.max(0, match.index - 20);
    return value.slice(start, match.index + match.length + 40).replace(/\s+/g, ' ').trim();
}

/**
 * Instruction-shaped text the model was told to ignore, one note per input
 * that contains one, shaped as assumption lines so the user sees it whatever
 * the model did. Added patterns apply as last read; `fresh()` first when the
 * caller can wait.
 */
function detectIgnoredInstructions(...texts) {
    return texts.filter(Boolean).map(excerpt).filter(Boolean).map((hit) => ({
        point: 'other',
        text: `The brief contained an instruction addressed to the AI ("${hit.slice(0, 80)}"); it was ignored.`,
    }));
}

const hasInstruction = (text) => detectIgnoredInstructions(text).length > 0;

const fresh = () => store().fresh();

module.exports = { INSTRUCTION_PATTERNS, MATCH_TIMEOUT_MS, detectIgnoredInstructions, hasInstruction, fresh };
