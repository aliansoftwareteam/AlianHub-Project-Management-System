// Turns the reason codes agentFit.js attaches to a ranking into the viewer's
// language. `t` is the i18n translate function, passed in so this stays pure.

const workLabel = (t, key) => (key ? t(`Parity.work_${key}`) : "");
const whyLabel = (t, key) => (key ? t(`Parity.why_${key}`) : "");

const localise = (t, { code, params = {}, text = "" }) => {
    if (!code) return text;
    const p = { ...params };
    if (p.work) p.work = workLabel(t, p.work);
    if (p.why) p.why = whyLabel(t, p.why);
    return t(`Parity.fit_${code}`, p);
};

export const fitReasonText = (t, row) => {
    if (!row) return "";
    if (Array.isArray(row.reasons) && row.reasons.length) return row.reasons.map((r) => localise(t, r)).join(" ");
    return row.reason || "";
};

export const refusalText = (t, row) => {
    if (!row) return "";
    if (row.refusalCode) return localise(t, { code: row.refusalCode, params: row.refusalParams, text: row.refusal });
    return row.refusal || "";
};

export const workLabelText = (t, work) => (work && work.labelKey ? workLabel(t, work.labelKey) : (work && work.label) || "");
