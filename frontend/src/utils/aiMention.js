import { decodeCommentText } from "./commentHtml";
import { answerHtml } from "@/views/Ai/askMarkdown";
import { sourceLink } from "@/views/Ai/askWhy";

/* Must match AI_MENTION_KEY in Modules/AI/aiMention.js. */
export const AI_MENTION_KEY = "ai_ask";
export const AI_MENTION_NAME = "AI";
export const AI_ACTOR = "ai";

const MARKUP = new RegExp(`\\[[^\\]]*\\]\\(\\s*${AI_MENTION_KEY}\\s*\\)`, "i");
const TYPED = /(^|\s)@ai(?=$|[\s,.:;!?])/i;

export const mentionsAi = (message) => {
    const text = String(message || "");
    return MARKUP.test(text) || TYPED.test(text);
};

export const aiAuthorOf = (row) => (row && row.actorType === AI_ACTOR ? { askerId: String(row.aiAskerId || "") } : null);

export const aiAskStateOf = (row) => (row && row.aiAsk && row.aiAsk.state) || "";

/* The router is optional so the answer still renders, with its refs unlinked, where there is none. */
export const aiAnswerHtml = (row, { router = null, companyId = "" } = {}) => answerHtml(decodeCommentText(row && row.message), {
    cited: (row && row.aiCitations) || [],
    hrefOf: (source) => {
        const to = sourceLink(source, companyId);
        if (!to || !router) return "";
        try {
            return router.resolve(to).href || "";
        } catch {
            return "";
        }
    },
});

/* The route a plain click on a citation should open in the app, or null to leave the click to the browser. */
export const citationTarget = (event, row, companyId = "") => {
    const link = event && event.target && typeof event.target.closest === "function" ? event.target.closest("a.ask-cite") : null;
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return null;
    const source = ((row && row.aiCitations) || []).find((c) => c && c.ref === link.getAttribute("data-cite"));
    return source ? sourceLink(source, companyId) : null;
};

/* Toast keys for the codes the server answers a posted @ai comment with. */
export const AI_MENTION_NOTICES = Object.freeze({
    ai_off: "AiMention.off",
    unconfigured: "AiMention.unconfigured",
    rate_limited: "AiMention.rate_limited",
    question_required: "AiMention.question_required",
});
