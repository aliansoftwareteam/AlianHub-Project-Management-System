import { apiRequest } from './services';
import store from '../store/store';

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

// Whether the company wants the cap at all (AHE-3831 follow-up).
//
// The switch lives on the company document as `trackerEstimateLimit` and is read from the
// store — the company is already loaded there in full (controller/company/company.js), so
// nothing extra is fetched for it.
//
// Absent means a company that predates the setting, and those companies have the cap today:
// only an explicit `false` turns it off. Written as `!== false` rather than a truthy test so
// a company document that failed to load cannot quietly disable the cap for everyone.
export function isEstimateLimitEnabled(company) {
  return (company && company.trackerEstimateLimit) !== false;
}

// Derive tracking status from a task document. Values in minutes.
//
// `limitEnabled` is the company switch. When it is off there is nothing to derive: no
// estimate is required to start and nothing auto-stops, so the caller is told the task is
// unblocked regardless of what the estimate says.
export function estimateStatusFromTask(task, limitEnabled = true) {
  const estimate = Number(task && task.totalEstimatedTime) || 0;
  const remainingRaw = Number(task && task.remainingHours);
  const remaining = Number.isFinite(remainingRaw) ? remainingRaw : estimate;
  const hasEstimate = estimate > 0;

  if (limitEnabled === false) {
    return {
      // FALSE even when the task does have an estimate. Every call site uses this as
      // `est.hasEstimate ? est.remainingMinutes : null` — the one decision it drives is
      // whether to arm the auto-stop for the session about to start. Reporting the task's
      // real state here would leave the deep-link path (which passes a real task rather
      // than going through fetchEstimateStatus) still capping the session with the setting
      // off. Nothing else reads it.
      hasEstimate: false,
      estimateMinutes: estimate,
      remainingMinutes: null,
      reached: false,
      blockStart: false,
      blockReason: null,
      blockMessage: null,
      limitEnabled: false,
    };
  }

  const reached = hasEstimate && remaining <= 0;
  const blockReason = !hasEstimate ? 'no-estimate' : (reached ? 'reached' : null);
  return {
    limitEnabled: true,
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
  // The company switch is read from the store rather than passed in by each caller, so the
  // four call sites keep the signature they already have.
  const limitEnabled = isEstimateLimitEnabled(store.getState()?.company?.currentCompany);

  // Nothing to check when the company has the cap off: the task read exists only to find
  // out how much estimate is left, and no answer to that can block anything now. Skipping
  // it also means turning the setting off removes a request from every tracker start.
  if (!limitEnabled) return { ...estimateStatusFromTask(null, false), ok: true };

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
