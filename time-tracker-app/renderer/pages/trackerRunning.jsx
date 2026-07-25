import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import Router from 'next/router';
import { setCaptures, setActivityTick, setTrackerStopTime, removeExtraClicks, setComment, setTrackerStartTime, removeAllTimeLog } from '../store/timelog';
import { TrackerController } from '../controller/tracker/tracker';
import { apiRequest } from '../utils/services';
import { fetchEstimateStatus } from '../utils/estimateLimit';
import store from '../store/store';
import moment from 'moment';
import { DateTime } from 'luxon';
import WasabiImage from '../components/WasabiImage/WasabiImage';

// const ipcRenderer = electron.ipcRenderer || false;

function TimeTrackerView() {
  const dispatch = useDispatch();
  const timeLog = useSelector((state) => state.timeLog);

  const [timeAgo, setTimeAgo] = useState("");
  const [keyboardClicks, setKeyboardClicks] = useState(timeLog.keyboardClicks);
  const isInterNetLost = useSelector((state)=> state.auth.isInternetLost);

  // Editing the active session's comment restarts the tracker on the same task.
  const [isEditing, setIsEditing] = useState(false);
  const [editComment, setEditComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const startEditComment = () => {
    setEditComment(timeLog.comment || "");
    setIsEditing(true);
  };

  const saveEditComment = async () => {
    const newComment = editComment.trim();
    if (!newComment || isSaving) return;
    setIsSaving(true);

    // Capture the running session's task context before it's cleared on stop.
    const prev = store.getState().timeLog;
    const ctx = {
      taskId: prev.taskId,
      projectId: prev.projectId,
      sprintId: prev.sprintId,
      taskName: prev.taskName,
      projectName: prev.projectName,
      folderName: prev.folderName,
      sprintName: prev.sprintName,
      taskTypeImage: prev.taskTypeImage,
    };

    try {
      // Stop the current session...
      await TrackerController.TrackerStop();
      dispatch(setTrackerStopTime());
      dispatch(removeAllTimeLog());

      // AHE-3831 — the stop finalized the prior session, so re-check the estimate
      // before restarting; if it's now met, stay stopped.
      const companyId = store.getState()?.company?.currentCompany?._id || "";
      const est = await fetchEstimateStatus(companyId, ctx.taskId);
      if (est.ok && est.blockStart) {
        try { window.ipc.send('estimate:limit', { reason: est.blockReason, taskName: ctx.taskName }); } catch (e) { /* best-effort */ }
        Router.push('/home');
        return;
      }

      // ...then start a fresh one on the same task with the new comment.
      window.ipc.send("start-listen-event");
      const startObj = {
        userId: store.getState().user?.user?._id || "",
        projectId: ctx.projectId || "",
        taskId: ctx.taskId || "",
        description: newComment,
        companyId: store.getState()?.company?.currentCompany?._id || "",
        actionTime: Math.floor(Number(DateTime.utc().ts) / 1000),
        type: "timesheets",
      };
      const res = await apiRequest('post', `/api/v3/timeTracker/start`, startObj);

      if (res?.data?.status) {
        autoStoppedRef.current = false;
        dispatch(setTrackerStartTime(res.data.statusText));
        dispatch(setComment({
          comment: newComment,
          sprintId: ctx.sprintId,
          taskId: ctx.taskId,
          projectId: ctx.projectId,
          taskName: ctx.taskName,
          projectName: ctx.projectName,
          folderName: ctx.folderName,
          sprintName: ctx.sprintName,
          taskTypeImage: ctx.taskTypeImage,
          remainingMinutes: est.hasEstimate ? est.remainingMinutes : null,
        }));
        setIsEditing(false);
        // Sync the ref to the just-updated store, else startScreenshotCapture sees
        // a stale trackerStart:false and bails without scheduling.
        timeLogRef.current = store.getState().timeLog;
        // Re-arm screenshot capture: a pending timer could have fired during the
        // stop→start gap (trackerStart false) and killed the chain.
        startScreenshotCapture();
      } else {
        // Couldn't restart (error/offline) — session is stopped, return home.
        console.error('Failed to restart tracker after comment edit', res);
        Router.push('/home');
      }
    } catch (error) {
      console.error('Edit-comment restart failed', error);
      Router.push('/home');
    } finally {
      setIsSaving(false);
    }
  };
  
  // Create refs to hold latest values
  const timeLogRef = React.useRef(timeLog);
  const keyboardClicksRef = React.useRef(keyboardClicks);
  const screenshotTimeoutRef = useRef(null);
  // AHE-3831 — guards the estimate auto-stop so it fires exactly once per session.
  const autoStoppedRef = useRef(false);

  // Update refs when values change
  useEffect(() => {
    timeLogRef.current = timeLog;
    keyboardClicksRef.current = timeLog.keyboardClicks;
    setKeyboardClicks(timeLog.keyboardClicks);
  }, [timeLog]);

  // Main effect without timeLog dependency
  useEffect(() => {
    window.ipc.removeAll('screenshot:captured');
    window.ipc.removeAll('activity:tick');
    window.ipc.removeAll('trackerStop:capture');
    // Setup event listeners
    window.ipc.on('screenshot:captured', handleScreenShot);
    window.ipc.on('activity:tick', setActivityEvent);
    window.ipc.on('trackerStop:capture', stopScreenshotCapture);

    // Start screenshot capture
    startScreenshotCapture();
    const dateTimeIntervalId = setInterval(dateTimeInterval, 1000);

    return () => {
      // Cleanup event listeners

      stopScreenshotCapture();
      clearInterval(dateTimeIntervalId);
    };
  }, []); // No timeLog dependency

  // Re-arm screenshot capture when a NEW session starts while this screen stays
  // mounted — e.g. a deep-link "stop & start new" handled by Layout. trackerID
  // changes per session; scheduleNextCapture clears any pending timer first, so
  // this is safe to run on mount too.
  useEffect(() => {
    if (timeLog.trackerStart) {
      timeLogRef.current = timeLog;
      startScreenshotCapture();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLog.trackerID]);

  const startScreenshotCapture = () => {

    const scheduleNextCapture = () => {
      if (screenshotTimeoutRef.current) {
        clearTimeout(screenshotTimeoutRef.current);
      }
      if (!timeLogRef.current.trackerStart) return;

      const minMinutes = 5; // Minimum minutes
      const maxMinutes = 9; // Maximum minutes
      const minSeconds = 0; // Minimum seconds
      const maxSeconds = 59; // Maximum seconds

      // Generate random minutes and seconds
      const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
      const randomSeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;

      // Calculate total timeout in milliseconds
      const timeout = (randomMinutes * 60 + randomSeconds) * 1000;

      console.log(`Next screenshot will be captured in ${randomMinutes} minutes and ${randomSeconds} seconds`);

      screenshotTimeoutRef.current = setTimeout(() => {
        if (timeLogRef.current.trackerStart) {
          window.ipc.send('screenshot:capture', {});
          scheduleNextCapture();
        }
      }, timeout);
    };

    scheduleNextCapture();
  };

  const stopScreenshotCapture = () => {
    if (screenshotTimeoutRef.current) {
      clearTimeout(screenshotTimeoutRef.current);
      screenshotTimeoutRef.current = null;
    }
  };

  const handleScreenShot = async (e, image) => {

    // Use ref to access latest timeLog
    const currentTimeLog = timeLogRef.current;

    // Drop stray/in-flight captures that arrive while no session is active —
    // e.g. during the stop→start gap of a deep-link "stop & start new" — so a
    // screenshot never logs to a cleared or previous session.
    if (!currentTimeLog.trackerStart || !currentTimeLog.startTime) return;

    const now = DateTime.now();
    const dateTimeWithSecondsZero = now.set({ second: 0 });
    const isoString = dateTimeWithSecondsZero.toISO();
    let previousTime = "";
    let previousSSTime = "";

    if (currentTimeLog.captures.length > 0) {
      previousTime = currentTimeLog.captures?.[currentTimeLog.captures.length - 1].time || '';
      const parsedDateTime = DateTime.fromISO(previousTime, { zone: 'utc' });
      const convertSe = parsedDateTime.set({ second: 0 });
      previousSSTime = convertSe.ts;
    } else {
      const luxonDateTime = DateTime.fromISO(currentTimeLog.startTime, { zone: 'utc' });
      const convertPrev = luxonDateTime.set({ second: 0 });
      previousSSTime = convertPrev.ts;
    }

    const strokes = manageStrokesData(previousTime, isoString);
    
    dispatch(setCaptures({ image: e.base64, time: isoString }));
    const file = new File([e.file], 'screenshot.png', { type: 'image/png' });
    
    try {
      const res = await TrackerController.ScreenShotCapture(file, previousSSTime, strokes);
      if (!res.status && res.isPermissionDenied) {
        await TrackerController.TrackerStop();
        store.dispatch(setTrackerStopTime());
        Router.push('/project-select');
      }
    } catch (error) {
      console.error('Screenshot capture error:', error);
    }
  };

  const manageStrokesData = (prev, curr) => {
    // Use ref to access latest keyboard clicks
    const currentClicks = keyboardClicksRef.current;
    let strokes = JSON.parse(JSON.stringify(currentClicks));
    
    dispatch(removeExtraClicks());
    
    let strokesData = [];
    if (strokes.length > 0) {
      strokesData = strokes.map(item => {
        const parsedDateTime = DateTime.fromMillis(Number(item.time), { zone: 'utc' });
        const utcTimestamp = parsedDateTime.set({ second: 0 });
        const utcTime = utcTimestamp.ts;
        return { [utcTime]: { keyboard: item.keyboard || 0, mouse: item.mouse || 0 } };
      });
    }
    return strokesData;
  };

  const dateTimeInterval = () => {
    // Use ref to access latest timeLog
    const currentTimeLog = timeLogRef.current;
    if (currentTimeLog?.captures.length > 0) {
      const timeAgo = getTimeAgo(moment(new Date(currentTimeLog.captures[currentTimeLog.captures.length - 1].time)));
      setTimeAgo(timeAgo);
    } else {
      setTimeAgo("");
    }
    checkEstimateLimit(currentTimeLog);
  };

  // AHE-3831 — auto-stop when this session's elapsed time reaches the minutes
  // that were left against the task estimate when it started. `remainingMinutes`
  // is null when the task has no estimate, so it never caps those.
  const checkEstimateLimit = async (currentTimeLog) => {
    if (autoStoppedRef.current) return;
    if (!currentTimeLog?.trackerStart || !currentTimeLog?.startTime) return;
    if (typeof currentTimeLog.remainingMinutes !== 'number') return;

    const elapsedMinutes = (Date.now() - new Date(currentTimeLog.startTime).getTime()) / 60000;
    if (elapsedMinutes < currentTimeLog.remainingMinutes) return;

    // Set the guard synchronously so the next 1s tick can't double-stop.
    autoStoppedRef.current = true;
    const taskName = currentTimeLog.taskName;
    try {
      await TrackerController.TrackerStop();
    } catch (e) {
      console.error('Estimate auto-stop failed', e);
    }
    dispatch(setTrackerStopTime());
    dispatch(removeAllTimeLog());
    try { window.ipc.send('estimate:limit', { reason: 'autostopped', taskName }); } catch (e) { /* best-effort */ }
    Router.push('/home');
  };

  const setActivityEvent = (e) => {
    dispatch(setActivityTick({ type: e && e.type }));
  };

  const getTimeAgo = (pastTime) => {
    const currentTime = moment();
    const duration = moment.duration(currentTime.diff(pastTime));
    const years = duration.years();
    const months = duration.months();
    const days = duration.days();
    const hours = duration.hours();
    const minutes = duration.minutes();

    if (years > 0) return `${years} years ago`;
    if (months > 0) return `${months} months ago`;
    if (days > 0) return `${days} days ago`;
    if (hours > 0) return `${hours} hours ago`;
    if (minutes > 0) return `${minutes} minutes ago`;
    return 'just now';
  };

  return (
    <div className="px-[15px] pt-3 pb-4">
      {isInterNetLost && (
        <div className="text-red-400 text-xs mb-2">Internet connection lost but we are still tracking your data</div>
      )}

      {/* Current task + comment card (mirrors the compact continue screen) */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-[0px_1.615384578704834px_12.115384101867676px_0px_#0000001F] text-left">
        <div
          className="truncate text-xs text-gray-500"
          title={`${timeLog?.folderName || ''} ${timeLog?.sprintName || ''}`}
        >
          {timeLog?.projectName}
          {timeLog?.folderName && (
            <>
              {" / "}
              <img src="/images/png/folder.png" className="w-[10px] h-[10px] mx-1 inline-block" alt="folder" />
              {timeLog?.folderName}
            </>
          )}
          {timeLog?.sprintName && ` / ${timeLog?.sprintName}`}
        </div>
        <p className="text-sm font-medium text-gray-800 mt-1 flex items-center gap-1.5">
          <WasabiImage url={timeLog?.taskTypeImage || ''} isUser={false} className="!w-[16px] !h-[16px] shrink-0" />
          <span className="truncate" title={timeLog?.taskName}>{timeLog?.taskName}</span>
        </p>

        <div className="border-t border-gray-100 my-3" />

        {isEditing ? (
          <div>
            <textarea
              className="w-full h-[70px] rounded-[5px] resize-none text-sm p-2 text-[#535358] border border-[#DFE1E6] outline-none focus:border-[#2F3990]"
              value={editComment}
              onChange={(e) => setEditComment(e.target.value)}
              placeholder="Comment"
              autoFocus
              disabled={isSaving}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
                className="px-3 py-1 text-sm text-gray-600 rounded hover:bg-gray-100 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEditComment}
                disabled={isSaving || !editComment.trim()}
                className="px-3 py-1 text-sm text-white bg-[#2F3990] rounded hover:bg-[#26317a] cursor-pointer disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-start gap-2">
            <span className="text-sm font-normal text-[#535358] break-words">
              {timeLog?.comment}
            </span>
            <button
              type="button"
              onClick={startEditComment}
              aria-label="Edit comment"
              className="cursor-pointer shrink-0 bg-transparent border-0 p-0"
            >
              <img src="/images/png/p_edit.png" alt="" />
            </button>
          </div>
        )}
      </div>

      {/* Latest Screen Capture */}
      <div className="mt-4">
        <div className="flex justify-between items-center text-xs text-gray-500 mb-1.5">
          <p>Latest Screen Capture</p>
          {timeLog?.captures.length > 0 && <p className="m-0">{timeAgo}</p>}
        </div>

        {timeLog?.captures?.length === 0 ? (
          <div className="w-full aspect-video px-4 flex flex-col items-center justify-center bg-white rounded-2xl text-center border border-gray-100 shadow-[0px_1.615384578704834px_12.115384101867676px_0px_#0000001F]">
            <img src="/images/png/no-screenshot.png" alt="No screenshot" className="mb-2" />
            <p className="text-xs font-normal text-gray-500">No screenshots captured yet for this session.</p>
          </div>
        ) : (
          <img
            src={timeLog?.captures[timeLog?.captures.length - 1].image}
            alt="Screenshot"
            className="w-full aspect-video object-cover rounded-2xl border border-gray-100 shadow-[0px_1.615384578704834px_12.115384101867676px_0px_#0000001F]"
          />
        )}
      </div>
    </div>
  );
}

export default TimeTrackerView;
