// How a run's taint marker reads on the run view, the replay, the inbox card and the audit log.
export const TAINT_KINDS = ["fetch", "email", "form", "webhook", "file", "passage"];

export const taintSourcesOf = (holder) => (Array.isArray(holder?.taintSources) ? holder.taintSources : Array.isArray(holder?.sources) ? holder.sources : []);

export const taintKindLabel = (t, kind) => (TAINT_KINDS.includes(kind) ? t(`Audit.taint_kind_${kind}`) : String(kind || ""));

export const taintSourcesLine = (t, sources) => taintSourcesOf({ sources }).map((s) => `${taintKindLabel(t, s.kind)} ${s.ref || ""}`.trim()).join(" · ");
