export const DECLINE_REASONS = Object.freeze(["too_many_changes", "wrong_tone", "needs_person", "not_now"]);

const count = (v) => Number(v || 0);

export const normaliseEpisode = (e) => {
    if (!e || typeof e !== "object") return null;
    return {
        proposed: count(e.proposed),
        acted: count(e.acted),
        approved: count(e.approved),
        declined: count(e.declined),
        reverted: Boolean(e.reverted),
        declinedReason: typeof e.declinedReason === "string" ? e.declinedReason : ""
    };
};

export const declineReasonText = (reason, t) => (DECLINE_REASONS.includes(reason) ? t(`Ai.decline_reason_${reason}`) : reason);

export const declinedLine = (episode, t) => {
    if (!episode.declinedReason) return t("Ai.episode_declined", { n: episode.declined });
    return t("Ai.episode_declined_reason", { n: episode.declined, reason: declineReasonText(episode.declinedReason, t) });
};

export const episodeSummary = (raw, t) => {
    const e = normaliseEpisode(raw);
    if (!e) return "";
    const parts = [t("Ai.episode_proposed", { n: e.proposed })];
    if (e.acted > 0) parts.push(t("Ai.episode_acted", { n: e.acted }));
    if (e.approved > 0) parts.push(t("Ai.episode_approved", { n: e.approved }));
    if (e.declined > 0) parts.push(declinedLine(e, t));
    if (e.reverted) parts.push(t("Ai.episode_reverted_yes"));
    return parts.join(", ");
};
