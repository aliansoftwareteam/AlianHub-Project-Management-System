// Opens a task in the desktop AlianHub Tracker via the `myapp://` protocol.
// The tracker is desktop-only, so mobile/tablet devices can't launch it.

export const isTrackerCapableDevice = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|IEMobile|Windows Phone|Mobile/i.test(ua);
  return !isMobile;
};

// Build myapp://open?taskId=..&projectId=..&sprintId=..&folderId=..&comment=..
// (parsed by key on the tracker side; folderId/comment optional).
export const buildTrackerDeepLink = ({ taskId, projectId, sprintId, folderId, comment } = {}) => {
  const params = new URLSearchParams();
  params.set('type', 'trackerStart'); // tells the tracker's main process to route this to prefill/start
  if (taskId) params.set('taskId', taskId);
  if (projectId) params.set('projectId', projectId);
  if (sprintId) params.set('sprintId', sprintId);
  if (folderId) params.set('folderId', folderId);
  if (comment) params.set('comment', comment);
  return `myapp://open?${params.toString()}`;
};

// Returns { ok, reason }. reason: 'missing' | 'unsupported' | 'launch-failed'.
// Note: browsers can't reliably tell if the protocol/app is installed, so a
// "nothing happened" case is indistinguishable from success — the caller should
// hint the user that the tracker must be installed.
export const openInTracker = (params = {}) => {
  if (!params.taskId || !params.projectId) return { ok: false, reason: 'missing' };
  if (!isTrackerCapableDevice()) return { ok: false, reason: 'unsupported' };
  try {
    window.location.href = buildTrackerDeepLink(params);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'launch-failed' };
  }
};
