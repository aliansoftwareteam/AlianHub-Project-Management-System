const FENCED = /^```[\w-]*\s*([\s\S]*?)\s*```$/;

// The stored prompts ask for `[{title: "..."}]`, a JavaScript literal rather than JSON, so bare
// keys are quoted and trailing commas dropped. String literals are matched first so their
// contents are never rewritten.
const STRING_BARE_KEY_OR_TRAILING_COMMA = /("(?:[^"\\]|\\.)*")|([A-Za-z_$][\w$]*)(\s*:)|,(\s*[\]}])/g;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isKey = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

export const isTitledItem = (item) => isPlainObject(item) && typeof item.title === 'string';

export const isChecklistItem = (item) => isPlainObject(item)
    && typeof item.name === 'string'
    && isKey(item.id)
    && (item.parentId === undefined || item.parentId === null || isKey(item.parentId));

export function parseGeneratedList(text, isItem) {
    if (typeof text !== 'string') return { ok: false };
    const body = text.trim().replace(FENCED, '$1').replace(/[\r\n]/g, '');
    const json = body.replace(STRING_BARE_KEY_OR_TRAILING_COMMA, (match, string, key, colon, closer) => {
        if (string) return string;
        if (key) return `"${key}"${colon}`;
        return closer;
    });
    let items;
    try {
        items = JSON.parse(json);
    } catch {
        return { ok: false };
    }
    if (!Array.isArray(items) || !items.every(isItem)) return { ok: false };
    return { ok: true, items };
}
