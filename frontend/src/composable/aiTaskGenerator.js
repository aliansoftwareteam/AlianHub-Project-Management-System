import { apiRequest } from '@/services';
import * as env from '@/config/env';

/**
 * Composable for the AI task generator (AHE-3777) — generates sprints +
 * tasks into an EXISTING project. Mirrors useAiProjectGenerator but scoped
 * to a project id and the tasks-only plan shape.
 *
 * Endpoints (Modules/AIProjectGenerator):
 *   POST /api/v1/ai/project/:projectId/tasks/plan     — async via SSE, returns a tasks plan
 *   POST /api/v1/ai/project/:projectId/tasks/execute  — persists the plan, returns jobId
 *   GET  /api/v1/ai-progress/:jobId                    — SSE progress stream (shared)
 */
export function useAiTaskGenerator() {

    async function generateTasks(projectId, { additionalRequirements, briefId, clarifications, mode, targetSprintName, features } = {}) {
        const res = await apiRequest('post', `${env.AI_PROJECT_TASKS_BASE}/${projectId}/tasks/plan`, {
            additionalRequirements: additionalRequirements || '',
            briefId: briefId || null,
            clarifications: Array.isArray(clarifications) && clarifications.length ? clarifications : null,
            mode: mode || 'full',
            targetSprintName: targetSprintName || '',
            features: features || {},
        });
        // Synchronous fallback if the server ever returns the plan inline.
        if (res.data && res.data.plan) return res.data;
        if (!res.data || !res.data.status || !res.data.jobId) return res.data;
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
                        planId: payload.planId,
                        projectId: payload.projectId,
                        plan: payload.plan,
                        tokensUsed: payload.tokensUsed,
                        model: payload.model,
                    });
                } else if (payload.event === 'error') {
                    if (unsubscribe) unsubscribe();
                    reject(new Error(payload.error || 'Task generation failed. Please try again.'));
                }
            });
        });
    }

    async function executeTasks(projectId, { plan, userName, mode, targetSprintId } = {}) {
        const res = await apiRequest('post', `${env.AI_PROJECT_TASKS_BASE}/${projectId}/tasks/execute`, {
            plan,
            userName: userName || '',
            mode: mode || 'full',
            targetSprintId: targetSprintId || '',
        });
        return res.data;
    }

    /**
     * Open an EventSource for jobId; calls onPayload for each event and
     * auto-closes on complete/error. Returns a close() function.
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
                // Ignore malformed events / heartbeats.
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
        generateTasks,
        executeTasks,
        subscribeToProgress,
    };
}
