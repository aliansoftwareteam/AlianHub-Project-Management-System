const KINDS = ["code", "seed", "workspace"];

export const skillSourceLabel = (t, source) => {
    if (!source || !KINDS.includes(source.kind)) return "";
    if (source.kind === "workspace") return t("Ai.run_skill_source_workspace", { n: source.version });
    return t(`Ai.run_skill_source_${source.kind}`);
};
