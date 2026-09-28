import markdownit from "markdown-it";
import { escapeHtml } from "@/utils/notificationHtml";
import { richHtml } from "@/utils/richHtml";

const markdown = markdownit({ html: false, linkify: false, breaks: true }).disable("image");

// Private-use characters hold each citation's place through Markdown and the sanitiser, which would otherwise
// read [OPS-1] as link syntax; the links go in after sanitising, built only from escaped values.
const SLOT_CHARS = /[\uE000\uE001]/g;
const SLOT = /\uE000(\d+)\uE001/g;
const CITE = /\[([^\]\n]{1,80})\]/g;

const SAFE_HREF = /^(\/(?!\/)|#)/;

const citeLink = (source, href) => (href && SAFE_HREF.test(href)
    ? `<a class="ask-cite" href="${escapeHtml(href)}" data-cite="${escapeHtml(source.ref)}">${escapeHtml(source.ref)}</a>`
    : `<span class="ask-cite">${escapeHtml(source.ref)}</span>`);

/* `hrefOf(source)` answers a link for a cited source, or "" to show its ref without one. */
export function answerHtml(text, { cited = [], hrefOf = () => "" } = {}) {
    const byRef = new Map((cited || []).filter((s) => s && s.ref).map((s) => [String(s.ref), s]));
    const slots = [];
    const marked = String(text == null ? "" : text)
        .replace(SLOT_CHARS, "")
        .replace(CITE, (whole, ref) => {
            const source = byRef.get(ref);
            if (!source) return whole;
            slots.push(source);
            return `\uE000${slots.length - 1}\uE001`;
        });
    return richHtml(markdown.render(marked)).replace(SLOT, (whole, n) => {
        const source = slots[Number(n)];
        return source ? citeLink(source, hrefOf(source)) : "";
    });
}

const INLINE_MARKS = /[*_`~#>]+/g;

/* A task name from an answer: its first line, without Markdown marks or citations, cut to the dialog's limit. */
export function taskTitleOf(text, max = 250) {
    const line = String(text == null ? "" : text).split("\n").map((l) => l.trim()).find(Boolean) || "";
    return line
        .replace(CITE, "")
        .replace(/^[-+*]\s+|^\d+\.\s+/, "")
        .replace(INLINE_MARKS, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[\s.:;,]+$/, "")
        .slice(0, max);
}
