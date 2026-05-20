import { apiRequest } from '@/services';
import * as env from '@/config/env';

/**
 * Composable for the AI Project Generator wizard.
 *
 * Endpoints (see Modules/AIProjectGenerator):
 *   POST /api/v1/ai/project/upload-brief   — multipart form, returns briefId
 *   POST /api/v1/ai/project/plan           — generates plan OR returns follow-up questions
 *   POST /api/v1/ai/project/clarify        — answers follow-ups, then plan
 *   POST /api/v1/ai/project/execute        — kicks off orchestrator, returns jobId
 *   GET  /api/v1/ai/project/execute/events/:jobId  — SSE progress stream
 */
export function useAiProjectGenerator() {

    async function uploadBrief(file) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiRequest('post', env.AI_PROJECT_UPLOAD_BRIEF, fd, 'form');
        return res.data;
    }

    async function generatePlan({ description, hints, briefId, conversationId, isPrivateSpace }) {
        const res = await apiRequest('post', env.AI_PROJECT_PLAN, {
            description,
            hints: hints || {},
            briefId: briefId || null,
            conversationId: conversationId || null,
            isPrivateSpace: !!isPrivateSpace,
        });
        return res.data;
    }

    async function clarify({ conversationId, answers, isPrivateSpace }) {
        const res = await apiRequest('post', env.AI_PROJECT_CLARIFY, {
            conversationId,
            answers,
            isPrivateSpace: !!isPrivateSpace,
        });
        return res.data;
    }

    async function execute({ plan, edits, userName, isPrivateSpace }) {
        // We send the full plan back to the server so the flow is stateless —
        // no dependency on an in-memory cache that would be lost on a backend
        // restart. The server re-validates the plan before executing.
        const res = await apiRequest('post', env.AI_PROJECT_EXECUTE, {
            plan,
            edits: edits || null,
            userName: userName || '',
            isPrivateSpace: !!isPrivateSpace,
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
        generatePlan,
        clarify,
        execute,
        subscribeToProgress,
    };
}
