'use strict';

const { FEATURES } = require('../AICore/features');
const { askJson, cleanLines, failure } = require('./assistCall');

const MODES = Object.freeze(['rewrite', 'shorten', 'expand', 'grammar', 'translate']);
const MAX_TEXT = 6000;
const MAX_TITLES = 25;
const TITLE_LENGTH = 200;
const LANGUAGE = /^[\p{L}][\p{L} ()-]{0,39}$/u;

const INSTRUCTION = Object.freeze({
    rewrite: 'Rewrite the text so it reads clearly and naturally. Keep its meaning, facts and language.',
    shorten: 'Make the text noticeably shorter. Keep every fact that matters and its language.',
    expand: 'Expand the text with useful detail and clearer structure. Invent no facts, names or numbers; keep its language.',
    grammar: 'Fix spelling, grammar and punctuation only. Change nothing else.',
    translate: 'Translate the text into {language}. Keep names, numbers and formatting.',
});

const IMPROVE_SYSTEM = (mode, language) => [
    'You edit a passage selected in a document or task description.',
    INSTRUCTION[mode].replace('{language}', language || ''),
    'Return plain text without markdown, quotes or commentary, as a single JSON object: {"text": "<edited text>"}.',
].join(' ');

const SPLIT_SYSTEM = [
    'You turn a passage selected in a document into project-management tasks.',
    `Return one task per distinct piece of work it describes, at most ${MAX_TITLES}.`,
    'Each title is a short imperative line under 80 characters, in the language of the passage. Invent no work the passage does not describe.',
    'Return a single JSON object: {"titles": ["<title>", ...]}.',
].join(' ');

const selectionOf = (text) => String(text == null ? '' : text).trim();

const checkText = (text) => {
    if (!text) return { status: false, code: 'text_required', reason: 'Select some text first.' };
    if (text.length > MAX_TEXT) return { status: false, code: 'text_too_long', reason: `Select at most ${MAX_TEXT} characters.` };
    return null;
};

/* A suggestion only: the editor shows it and the person decides to replace or insert it. */
async function improveSelection({ companyId, uid, mode, text, language }) {
    if (!MODES.includes(mode)) return { status: false, code: 'invalid_mode', reason: 'Unknown edit.' };
    const selection = selectionOf(text);
    const refused = checkText(selection);
    if (refused) return refused;
    const lang = String(language || '').trim();
    if (mode === 'translate' && !LANGUAGE.test(lang)) return { status: false, code: 'language_required', reason: 'Name the language to translate into.' };
    const outcome = await askJson({
        system: IMPROVE_SYSTEM(mode, lang),
        data: selection,
        maxTokens: Math.min(4000, Math.ceil(selection.length / 2) + 400),
        spend: { feature: FEATURES.WRITING_ASSIST, companyId, userId: uid },
        temperature: mode === 'grammar' ? 0 : 0.3,
    });
    if (!outcome.ok) return failure(outcome);
    const edited = String(outcome.value.text || '').trim();
    if (!edited) return { status: false, code: 'bad_answer', reason: 'The model returned no text.' };
    return { status: true, data: { text: edited } };
}

/* Titles only: the tasks are created by the person, in a list they pick, through the normal path. */
async function splitSelection({ companyId, uid, text }) {
    const selection = selectionOf(text);
    const refused = checkText(selection);
    if (refused) return refused;
    const outcome = await askJson({
        system: SPLIT_SYSTEM,
        data: selection,
        maxTokens: 900,
        spend: { feature: FEATURES.WRITING_ASSIST, companyId, userId: uid },
    });
    if (!outcome.ok) return failure(outcome);
    const titles = cleanLines(outcome.value.titles, { max: MAX_TITLES, maxLength: TITLE_LENGTH });
    if (!titles.length) return { status: false, code: 'no_tasks', reason: 'No tasks were found in the selection.' };
    return { status: true, data: { titles } };
}

module.exports = { improveSelection, splitSelection, MODES, MAX_TEXT };
