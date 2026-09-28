import { ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { streamAsk } from "./askStream";
import { messageKey } from "./askWhy";

const CODE_KEYS = Object.freeze({ thread_not_found: "Ask.error_thread_not_found" });

const storedTurn = (turn) => {
    const cited = Array.isArray(turn.cited) ? turn.cited : [];
    return {
        key: turn.turnId,
        turnId: turn.turnId,
        question: turn.question,
        answer: turn.answer || "",
        mode: turn.mode || "ask",
        usage: { model: turn.model || "" },
        cited,
        sources: cited.filter((source) => source.available !== false),
        status: "done",
        error: ""
    };
};

/* One Ask conversation and the asker's saved threads. `announcement` is what the polite live region says:
 * set once a turn settles, never per token. */
export function useAskConversation({ t }) {
    const turns = ref([]);
    const threadId = ref("");
    const threads = ref([]);
    const threadsLoading = ref(false);
    const streaming = ref(false);
    const announcement = ref("");
    let controller = null;
    let seq = 0;

    const coded = (code, sentence) => {
        const key = CODE_KEYS[code] || messageKey(code);
        return key ? t(key) : sentence || "";
    };

    const loadThreads = async () => {
        threadsLoading.value = true;
        try {
            const res = await apiRequest("get", env.AI_ASK_THREADS);
            if (res?.data?.status) threads.value = res.data.data?.threads || [];
        } catch {
            /* the list is a convenience; the conversation works without it */
        } finally {
            threadsLoading.value = false;
        }
    };

    const settle = (live, result) => {
        const payload = result.payload || {};
        if (result.kind === "done") {
            Object.assign(live, {
                status: "done",
                answer: payload.answer || "",
                cited: payload.cited || [],
                sources: payload.sources || [],
                scope: payload.scope,
                mode: payload.mode,
                usage: payload.usage,
                turnId: payload.turnId || ""
            });
            if (payload.threadId && payload.threadId !== threadId.value) {
                threadId.value = payload.threadId;
                loadThreads();
            }
            return t("Ask.answer_ready");
        }
        if (result.kind === "error") {
            live.status = "error";
            live.error = coded(payload.code, payload.statusText) || t("Ask.stream_failed");
            return live.error;
        }
        if (!payload.status) {
            live.status = "error";
            live.error = coded(payload.code, payload.statusText) || t("Parity.ask_failed");
            return live.error;
        }
        const data = payload.data || {};
        live.sources = data.sources || [];
        if (data.configured === false) {
            live.status = "unconfigured";
            live.error = t("AiLanding.no_model_note");
        } else {
            live.status = "empty";
            live.error = coded(data.emptyCode, data.empty);
        }
        return live.error;
    };

    const send = async ({ question, mode = "ask", projectId = "" }) => {
        const asked = String(question || "").trim();
        if (!asked || streaming.value) return false;
        seq += 1;
        turns.value.push({ key: `local-${seq}`, question: asked, answer: "", mode, cited: [], sources: [], status: "streaming", error: "" });
        const live = turns.value[turns.value.length - 1];
        const body = { question: asked, mode };
        if (projectId) body.projectId = projectId;
        if (threadId.value) body.threadId = threadId.value;
        announcement.value = "";
        streaming.value = true;
        controller = new AbortController();
        try {
            const result = await streamAsk({ body, signal: controller.signal, onToken: (text) => { live.answer += text; } });
            announcement.value = settle(live, result);
        } catch (error) {
            if (error && error.name === "AbortError") {
                live.status = "stopped";
                announcement.value = t("Ask.answer_stopped");
            } else {
                live.status = "error";
                live.error = t("Ask.stream_failed");
                announcement.value = live.error;
            }
        } finally {
            streaming.value = false;
            controller = null;
        }
        return true;
    };

    /* An answer the command palette already fetched from /ask. It belongs to no thread, so a follow-up starts one. */
    const seed = (question, answer) => {
        const asked = String(question || "").trim();
        if (!asked || !answer) return;
        seq += 1;
        const turn = { key: `local-${seq}`, question: asked, answer: "", mode: answer.mode || "ask", cited: [], sources: [], status: "streaming", error: "" };
        settle(turn, answer.answer
            ? { kind: "done", payload: { ...answer, threadId: "" } }
            : { kind: "json", payload: { status: true, data: answer } });
        turns.value = [turn];
    };

    const stop = () => {
        if (controller) controller.abort();
    };

    const newQuestion = () => {
        stop();
        turns.value = [];
        threadId.value = "";
        announcement.value = "";
    };

    const openThread = async (id) => {
        stop();
        try {
            const res = await apiRequest("get", `${env.AI_ASK_THREADS}/${encodeURIComponent(id)}`);
            if (!res?.data?.status) return coded(res?.data?.code, res?.data?.statusText) || t("Ask.thread_load_failed");
            const thread = res.data.data || {};
            turns.value = (thread.turns || []).map(storedTurn);
            threadId.value = String(thread.id || id);
            announcement.value = "";
            return "";
        } catch {
            return t("Ask.thread_load_failed");
        }
    };

    const removeThread = async (id) => {
        try {
            const res = await apiRequest("delete", `${env.AI_ASK_THREADS}/${encodeURIComponent(id)}`);
            if (!res?.data?.status) return coded(res?.data?.code, res?.data?.statusText) || t("Ask.thread_delete_failed");
            threads.value = threads.value.filter((thread) => thread.id !== id);
            if (threadId.value === id) newQuestion();
            return "";
        } catch {
            return t("Ask.thread_delete_failed");
        }
    };

    return { turns, threadId, threads, threadsLoading, streaming, announcement, send, seed, stop, newQuestion, loadThreads, openThread, removeThread };
}
