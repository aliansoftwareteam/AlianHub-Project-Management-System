// Phrases that read as instructions to the model rather than facts about the
// project. Deliberately short and generic: the prompts do the real work, this
// only guarantees a person sees a note when one slipped in, and that memory
// never stores one.
const INSTRUCTION_PATTERNS = [
    /ignore (?:all |any |the |every )?(?:previous|prior|above|earlier|preceding) (?:instructions?|rules?|prompts?|guidance)/i,
    /disregard (?:all |any |the |every )?(?:previous|prior|above|earlier|preceding) (?:instructions?|rules?|prompts?)/i,
    /(?:do not|don't|never) follow (?:the |your |any )?(?:rules|instructions|system prompt)/i,
    /\bsystem prompt\b/i,
    /\byou are now\b/i,
    /\bfrom now on,? (?:you|act|respond|answer)\b/i,
    /reveal (?:your|the) (?:instructions|prompt|rules)/i,
];

function excerpt(text, pattern) {
    const match = pattern.exec(String(text || ''));
    if (!match) return null;
    const start = Math.max(0, match.index - 20);
    return String(text).slice(start, match.index + match[0].length + 40).replace(/\s+/g, ' ').trim();
}

/**
 * Instruction-shaped text the model was told to ignore, one note per input
 * that contains one, shaped as assumption lines so the user sees it whatever
 * the model did.
 */
function detectIgnoredInstructions(...texts) {
    const found = [];
    for (const text of texts) {
        if (!text) continue;
        for (const pattern of INSTRUCTION_PATTERNS) {
            const hit = excerpt(text, pattern);
            if (hit) {
                found.push(hit);
                break;
            }
        }
    }
    return found.map((hit) => ({
        point: 'other',
        text: `The brief contained an instruction addressed to the AI ("${hit.slice(0, 80)}"); it was ignored.`,
    }));
}

const hasInstruction = (text) => detectIgnoredInstructions(text).length > 0;

module.exports = { INSTRUCTION_PATTERNS, detectIgnoredInstructions, hasInstruction };
