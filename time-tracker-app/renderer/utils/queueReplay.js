import {
  getQueueEntries,
  removeFromQueueByKey,
  objectToFormData,
} from './apiQueue';
import {
  apiRequest,
  apiRequestFormData,
  apiRequestWithoutCompnay,
  apiRequestWithoutSecure,
} from './services';

// Draining the offline queue.
//
// This lives here rather than inside Layout so that logout can flush before it refuses.
// Logout used to only LOOK at the queue and show the offline screen when it was non-empty,
// while the only thing that ever drained it was a 30s interval that runs exclusively while
// the app believes it is offline. Back online, nothing drained it — so one stuck entry
// blocked logout permanently, under a message about the internet connection.

// Endpoints that are safe to send again. Anything else was queued but has no replay
// defined, and is dropped rather than kept forever.
const REPLAYABLE = [
  '/api/v4/timeTracker/capture',
  '/api/v2/timeTracker/end',
  '/api/v3/timeTracker/start',
];

async function sendOne(req) {
  if (req.method === 'apiRequest') {
    if (!REPLAYABLE.includes(req.endPoint)) return 'skipped';
    // The server must bill this to when it HAPPENED, not when it finally arrived.
    req.data.considerActionTime = true;
    await apiRequest(req.type, req.endPoint, req.data, req.dataType);
    return 'sent';
  }
  if (req.method === 'apiRequestFormData') {
    const body = req.dataType === 'form' ? objectToFormData(req.data) : req.data;
    await apiRequestFormData(req.type, req.endPoint, body, req.dataType);
    return 'sent';
  }
  if (req.method === 'apiRequestWithoutCompnay') {
    await apiRequestWithoutCompnay(req.type, req.endPoint, req.data);
    return 'sent';
  }
  if (req.method === 'apiRequestWithoutSecure') {
    await apiRequestWithoutSecure(req.type, req.endPoint, req.data, req.dataType);
    return 'sent';
  }
  return 'skipped';
}

/**
 * A 4xx is the server saying it will never accept this payload — retrying cannot fix it,
 * and keeping it means the queue never empties. A 5xx or a network error is transient and
 * the entry is worth holding on to.
 *
 * The distinction matters because these entries are the user's tracked time: dropping on
 * any failure would quietly lose work, and dropping on none blocks the app forever.
 */
function isPermanentRejection(error) {
  const status = error && error.response && error.response.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Replay everything queued. Returns { sent, dropped, remaining } so the caller can tell the
 * difference between "all clear", "still offline" and "we gave up on some".
 */
export async function replayQueue() {
  const entries = await getQueueEntries();
  let sent = 0;
  let dropped = 0;

  for (const { key, value: req } of entries) {
    try {
      const outcome = await sendOne(req);
      // Deleted by KEY, not by position: removeFirstFromQueue always dropped the head, so
      // one skipped or failed entry made every later success delete the wrong row.
      await removeFromQueueByKey(key);
      if (outcome === 'sent') sent += 1; else dropped += 1;
    } catch (error) {
      if (!navigator.onLine) break;   // genuinely offline — keep it and try again later
      if (isPermanentRejection(error)) {
        console.error('Dropping queued request the server rejected:', req && req.endPoint, error);
        await removeFromQueueByKey(key);
        dropped += 1;
        continue;
      }
      // Online but the request failed for a reason that may pass. Stop here rather than
      // walking the rest: the queue is ordered, and later entries may depend on this one.
      break;
    }
  }

  const remaining = (await getQueueEntries()).length;
  return { sent, dropped, remaining };
}
