import { apiRequest } from "@/services";
import * as env from "@/config/env";

const SETTLED = ["ALREADY_UNDONE", "NOTHING_TO_UNDO"];

/* One import job per ClickUp list. Answers what happened to each: undone, already settled, held back because someone
   has worked on its tasks (with their names), or failed. */
export async function undoImportJob(jobId, keepEdited) {
    try {
        const { data } = await apiRequest("post", `${env.IMPORTS}/${jobId}/undo`, { keepEdited });
        if (data?.status) return { outcome: "undone", trashed: data.data.trashed || 0, kept: data.data.kept || [] };
        return answerOf(data);
    } catch (error) {
        return answerOf(error?.response?.data, error?.message);
    }
}

function answerOf(body, fallback = "") {
    if (body?.code === "EDITED") return { outcome: "edited", edited: body.data?.edited || [], editedCount: body.data?.editedCount || 0 };
    if (SETTLED.includes(body?.code)) return { outcome: "settled" };
    return { outcome: "failed", message: body?.statusText || fallback };
}
