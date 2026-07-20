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
export const openInTracker = (params = {}, opts = {}) => {
  if (!params.taskId || !params.projectId) return { ok: false, reason: 'missing' };
  if (!isTrackerCapableDevice()) return { ok: false, reason: 'unsupported' };
  try {
    // Best-effort "did the tracker actually open?" check. A browser can't query
    // installed apps, so we watch for this tab losing focus/visibility: when the
    // OS hands off to the tracker, the page is backgrounded. If that doesn't
    // happen within the timeout, the tracker is either NOT INSTALLED or too OLD
    // to register the myapp:// handler — indistinguishable from the web, so the
    // caller shows ONE generic "install / update the tracker" toast for both.
    const onNotOpened = typeof opts.onNotOpened === 'function' ? opts.onNotOpened : null;
    if (onNotOpened && typeof window !== 'undefined' && typeof document !== 'undefined') {
      let opened = false;
      const markOpened = () => { opened = true; };
      const onVisibility = () => { if (document.hidden) opened = true; };
      window.addEventListener('blur', markOpened, { once: true });
      document.addEventListener('visibilitychange', onVisibility);
      setTimeout(() => {
        window.removeEventListener('blur', markOpened);
        document.removeEventListener('visibilitychange', onVisibility);
        if (!opened) onNotOpened();
      }, 1500);
    }
    window.location.href = buildTrackerDeepLink(params);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'launch-failed' };
  }
};
