import { apiRequest } from '@/services';
import * as env from '@/config/env';

/**
 * Composable for the AI Project Generator wizard.
 *
 * Endpoints (see Modules/AIProjectGenerator):
 *   POST /api/v1/ai/project/upload-brief   — multipart form, returns briefId
 *   POST /api/v1/ai/project/clarify        — returns clarifying questions (sync)
 *   POST /api/v1/ai/project/plan           — generates a plan (async via SSE)
 *   POST /api/v1/ai/project/execute        — kicks off orchestrator, returns jobId
 *   GET  /api/v1/ai-progress/:jobId        — SSE progress stream
 *
 * Wizard flow:
 *   Describe → (Clarify Q&A) → Review plan → Create
 *
 * The Clarify step is *optional*: if the LLM returns zero questions, or if
 * the call fails for any reason, the wizard skips straight to plan
 * generation without breaking. The plan endpoint accepts an optional
 * `clarifications` array — the user's answers — so the model has
 * authoritative context for the plan.
 */
export function useAiProjectGenerator() {

    async function uploadBrief(file) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiRequest('post', env.AI_PROJECT_UPLOAD_BRIEF, fd, 'form');
        return res.data;
    }

    /**
     * Ask the backend to generate clarifying questions for the current brief.
     * Synchronous endpoint — returns the questions inline.
     *
     * Resolves to `{ status, understanding, questions }`. Caller treats
     * `questions: []` as "skip Q&A". Caller can also wrap this in try/catch
     * and on failure jump straight to generatePlan() without clarifications;
     * the backend tolerates that.
     */
    async function generateClarifyingQuestions({ description, additionalRequirements, briefId }) {
        const res = await apiRequest('post', env.AI_PROJECT_CLARIFY, {
            description,
            additionalRequirements: additionalRequirements || '',
            briefId: briefId || null,
        });
        return res.data || { status: false, questions: [] };
    }

    async function generatePlan({ description, additionalRequirements, briefId, isPrivateSpace, clarifications }) {
        const res = await apiRequest('post', env.AI_PROJECT_PLAN, {
            description,
            additionalRequirements: additionalRequirements || '',
            briefId: briefId || null,
            isPrivateSpace: !!isPrivateSpace,
            clarifications: Array.isArray(clarifications) && clarifications.length ? clarifications : null,
        });
        if (res.data && res.data.plan) {
            return res.data;
        }
        if (!res.data || !res.data.status || !res.data.jobId) {
            return res.data;
        }
        return waitForPlan(res.data.jobId);
    }

    function waitForPlan(jobId) {
        return new Promise((resolve, reject) => {
            let unsubscribe = null;
            unsubscribe = subscribeToProgress(jobId, (payload) => {
                if (!payload) return;
                if (payload.data) payload = payload.data;

                if (payload.event === 'complete' && (payload.phase === 'plan' || payload.plan)) {
                    if (unsubscribe) unsubscribe();
                    resolve({
                        status: true,
                        needsClarification: false,
                        planId: payload.planId,
                        plan: payload.plan,
                        tokensUsed: payload.tokensUsed,
                        model: payload.model,
                    });
                } else if (payload.event === 'error') {
                    if (unsubscribe) unsubscribe();
                    reject(new Error(payload.error || 'Plan generation failed. Please try again.'));
                }
            });
        });
    }

    async function execute({ plan, edits, userName, isPrivateSpace, proposalId }) {
        // We send the full plan back to the server so the flow is stateless —
        // no dependency on an in-memory cache that would be lost on a backend
        // restart. The server re-validates the plan before executing.
        const res = await apiRequest('post', env.AI_PROJECT_EXECUTE, {
            plan,
            edits: edits || null,
            userName: userName || '',
            isPrivateSpace: !!isPrivateSpace,
            proposalId: proposalId || '',
        });
        return res.data;
    }

    /**
     * Open an EventSource for the given jobId and call `onPayload(payload)`
     * for every event. Returns a `close()` function. The server emits one
     * of:
     *   { event: 'progress', step, status, ... }
     *   { event: 'complete', projectId, totals }
     *   { event: 'error', error, rolledBack }
     */
    function subscribeToProgress(jobId, onPayload) {
        if (!jobId) throw new Error('jobId required');
        const url = `${env.API_URI}${env.AI_PROJECT_EVENTS}/${encodeURIComponent(jobId)}`;
        const src = new EventSource(url);
        src.onmessage = (evt) => {
            if (!evt || !evt.data) return;
            try {
                const payload = JSON.parse(evt.data);
                onPayload(payload);
                if (payload && (payload.event === 'complete' || payload.event === 'error')) {
                    src.close();
                }
            } catch (e) {
                // Ignore malformed events (heartbeats arrive as comments, not 'message' events).
            }
        };
        src.onerror = () => {
            try { src.close(); } catch (_e) { /* ignore */ }
            onPayload({ event: 'error', error: 'Lost connection to progress stream' });
        };
        return () => {
            try { src.close(); } catch (_e) { /* ignore */ }
        };
    }

    return {
        uploadBrief,
        generateClarifyingQuestions,
        generatePlan,
        execute,
        subscribeToProgress,
    };
}
