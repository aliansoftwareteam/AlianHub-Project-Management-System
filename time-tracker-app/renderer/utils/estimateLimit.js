import { apiRequest } from './services';

// AHE-3831 — tracking is gated on a task's estimated hours:
//   • no estimate set          → cannot start (must add an estimate first)
//   • estimate set, time left   → starts, and auto-stops at the estimate
//   • estimate already met/over → cannot start
// The estimate is `task.totalEstimatedTime` (minutes); the server keeps
// `task.remainingHours = estimate − all-users-logged` fresh. BOTH fields are
// `undefined` on a fresh task until an estimate is added — `Number(undefined) || 0`
// treats that as 0 (no estimate), which is exactly the "cannot start" case.

export const ESTIMATE_LIMIT_MESSAGE = 'Tracker reached task estimate hours limit';
export const NO_ESTIMATE_MESSAGE = 'Add estimated hours to start the tracker';

// Derive tracking status from a task document. Values in minutes.
export function estimateStatusFromTask(task) {
  const estimate = Number(task && task.totalEstimatedTime) || 0;
  const remainingRaw = Number(task && task.remainingHours);
  const remaining = Number.isFinite(remainingRaw) ? remainingRaw : estimate;
  const hasEstimate = estimate > 0;
  const reached = hasEstimate && remaining <= 0;
  const blockReason = !hasEstimate ? 'no-estimate' : (reached ? 'reached' : null);
  return {
    hasEstimate,
    estimateMinutes: estimate,
    remainingMinutes: Math.max(remaining, 0),
    reached,
    // Start is blocked when there is no estimate at all, or the estimate is met.
    blockStart: blockReason !== null,
    blockReason,
    blockMessage:
      blockReason === 'no-estimate' ? NO_ESTIMATE_MESSAGE :
      blockReason === 'reached' ? ESTIMATE_LIMIT_MESSAGE : null,
  };
}

// Fetch a task's status from the server (fresh remainingHours).
// `ok` reports whether the task was actually read. Callers must ENFORCE the
// block only when `ok` is true, so a transient fetch failure never blocks
// legitimate tracking (fail open).
export async function fetchEstimateStatus(companyId, taskId) {
  try {
    if (!companyId || !taskId) return { ...estimateStatusFromTask(null), ok: false };
    const res = await apiRequest('post', `/api/v1/task/find`, {
      findQuery: [
        { $match: { objId: { _id: taskId, CompanyId: companyId } } },
      ],
    });
    const task = res && res.data && res.data[0];
    if (!task) return { ...estimateStatusFromTask(null), ok: false };
    return { ...estimateStatusFromTask(task), ok: true };
  } catch (e) {
    console.error('fetchEstimateStatus error', e);
    return { ...estimateStatusFromTask(null), ok: false };
  }
}
