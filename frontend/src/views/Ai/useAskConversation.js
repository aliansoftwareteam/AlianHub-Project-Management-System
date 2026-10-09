import { ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { streamAsk } from "./askStream";
import { messageKey } from "./askWhy";
import { sendProposalDecision } from "@/composable/agentProposals";

const CODE_KEYS = Object.freeze({ thread_not_found: "Ask.error_thread_not_found" });

const PLAN_KEYS = Object.freeze({
    ai_off: "Ask.plan_ai_off",
    no_key: "Ask.plan_needs_key",
    unpriced: "Ask.plan_unpriced",
    nothing_planned: "Ask.plan_nothing",
    too_long: "Ask.plan_too_long",
    project_not_found: "Ask.plan_project_not_found",
    plan_failed: "Ask.plan_failed"
});

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
                turnId: payload.turnId || "",
                shareToken: payload.shareToken || ""
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

    const send = async ({ question, mode = "ask", projectId = "", skill = "", context = [] }) => {
        const asked = String(question || "").trim();
        if (!asked || streaming.value) return false;
        seq += 1;
        turns.value.push({ key: `local-${seq}`, question: asked, answer: "", mode, cited: [], sources: [], status: "streaming", error: "" });
        const live = turns.value[turns.value.length - 1];
        const body = { question: asked, mode };
        if (projectId) body.projectId = projectId;
        if (threadId.value) body.threadId = threadId.value;
        if (skill) body.skill = skill;
        if (Array.isArray(context) && context.length) body.context = context;
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

    /* A sentence planned with the server's model. It comes back as a proposal the person approves or declines; nothing is made before. */
    const plan = async ({ sentence, projectId = "" }) => {
        const asked = String(sentence || "").trim();
        if (!asked || streaming.value) return false;
        seq += 1;
        turns.value.push({ key: `local-${seq}`, question: asked, answer: "", mode: "plan", cited: [], sources: [], cannot: [], status: "planning", error: "" });
        const live = turns.value[turns.value.length - 1];
        streaming.value = true;
        announcement.value = "";
        try {
            const res = await apiRequest("post", env.AI_ASK_PLAN, { sentence: asked, ...(projectId ? { projectId } : {}) });
            const body = res?.data || {};
            const data = body.data || {};
            const code = data.code || body.code;
            if (body.status && data.planned) {
                Object.assign(live, {
                    status: "planned",
                    plan: { proposalId: data.proposalId, summary: data.summary || "", changes: data.changes || [], cannot: data.cannot || [], decision: "pending", busy: false, error: "" }
                });
                announcement.value = t("Ask.plan_ready");
            } else {
                Object.assign(live, {
                    status: body.status ? "plan_none" : "plan_error",
                    error: PLAN_KEYS[code] ? t(PLAN_KEYS[code]) : body.statusText || t("Ask.plan_failed"),
                    needsAi: code === "no_key",
                    cannot: data.cannot || []
                });
                announcement.value = live.error;
            }
        } catch {
            Object.assign(live, { status: "plan_error", error: t("Ask.plan_failed") });
            announcement.value = live.error;
        } finally {
            streaming.value = false;
        }
        return true;
    };

    const decidePlan = async (turn, verb) => {
        const planned = turn && turn.plan;
        if (!planned || planned.busy || planned.decision !== "pending") return;
        planned.busy = true;
        planned.error = "";
        try {
            const res = await sendProposalDecision(planned.proposalId, verb);
            if (res?.data?.status) planned.decision = verb === "approve" ? "approved" : "declined";
            else planned.error = res?.data?.statusText || res?.data?.message || t("Ask.plan_decide_failed");
        } catch {
            planned.error = t("Ask.plan_decide_failed");
        } finally {
            planned.busy = false;
        }
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

    return { turns, threadId, threads, threadsLoading, streaming, announcement, send, plan, decidePlan, seed, stop, newQuestion, loadThreads, openThread, removeThread };
}
