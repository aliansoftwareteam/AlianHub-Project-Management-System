import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import Router from 'next/router';
import { setCaptures, setActivityTick, setTrackerStopTime, removeExtraClicks } from '../store/timelog';
import { TrackerController } from '../controller/tracker/tracker';
import store from '../store/store';
import moment from 'moment';
import { DateTime } from 'luxon';

// const ipcRenderer = electron.ipcRenderer || false;

function TimeTrackerView() {
  const dispatch = useDispatch();
  const timeLog = useSelector((state) => state.timeLog);
  
  const [timeAgo, setTimeAgo] = useState("");
  const [keyboardClicks, setKeyboardClicks] = useState(timeLog.keyboardClicks);
  const isInterNetLost = useSelector((state)=> state.auth.isInternetLost);
  
  // Create refs to hold latest values
  const timeLogRef = React.useRef(timeLog);
  const keyboardClicksRef = React.useRef(keyboardClicks);
  const screenshotTimeoutRef = useRef(null);

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
        return { [utcTime]: { active: item.active || 0 } };
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
  };

  const setActivityEvent = () => {
    dispatch(setActivityTick());
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
    // <div className="p-4">
    //   <div className="bg-white shadow-md rounded-lg p-4 mb-4">
    //     <span className="text-gray-700">{timeLog?.comment}</span>
    //     <img src="/images/png/p_edit.png" alt="edit" />
    //   </div>
    //   <div className="mt-2">
    //     <div className="flex justify-between items-center text-gray-500">
    //       <p>Latest Screen Capture</p>
    //       {timeLog?.captures.length > 0 && <p>{timeAgo}</p>}
    //     </div>
    //     {timeLog?.captures?.length === 0 && (
    //       <div className="screenShotView">
    //         <img src="/images/png/no-screenshot.png" alt="No screenshot" />
    //         <p>You haven't worked on this task before</p>
    //       </div>
    //     )}
    //     {timeLog?.captures?.length > 0 && (
    //       <div className="screenShotView screenShotCapture">
    //         <img src={timeLog?.captures[timeLog?.captures.length - 1].image} alt="Screenshot" />
    //       </div>
    //     )}
    //   </div>
    // </div>
    <div className="p-4">
      <div className='text-red-400 my-2.5'>{isInterNetLost ? 'Internet connection lost but we are still tracking your data' : ''}</div>
      <div className="mx-auto mt-0 rounded-lg">
      <div className="flex justify-between items-start bg-white p-4 shadow-md mb-4 rounded-lg mx-2 text-left">
        <span className="text-[14px] font-normal text-[#535358]"> 
          {timeLog?.comment}
        </span>
        <img src="/images/png/p_edit.png" alt="edit" />
      </div>
    
      <div className="py-0 w-11/12 mx-auto">
        <div className="w-full mt-2">
          <div className="flex items-center text-gray-500">
            <div className="w-full flex justify-between font-normal text-sm leading-6 text-gray-500 mb-1">
              <p>Latest Screen Capture</p>
              {timeLog?.captures.length > 0 && <p className="m-0">{timeAgo}</p>}
            </div>
          </div>


    
          {timeLog?.captures?.length === 0 ? (
            <div className="p-[45px] px-[15px] w-[94%] mx-auto bg-white rounded-lg text-center shadow-md my-5">
              <div className='flex justify-center mb-2.5'>
                <img src="/images/png/no-screenshot.png" alt="No screenshot" />
              </div>
              <p className="text-xs font-normal text-gray-500">No screenshots captured yet for this session.</p>
            </div>
          ) : (
            <div className="w-full">
              <img
                src={timeLog?.captures[timeLog?.captures.length - 1].image}
                alt="Screenshot"
                className="w-full h-full max-h-full rounded-lg shadow-md"
              />
            </div>
          )}
        </div>
      </div>
    
      {/* <div className="py-4">
        <div className="flex justify-between items-center">
          <h4 className="font-medium text-sm leading-6 text-blue-900 m-0">Work Diary</h4>
          <span className="font-light text-sm leading-6 m-0">
            Today, {moment(new Date(timeLog.startTime)).format('hh:mm A')}
          </span>
        </div>
    
        <div className="py-2 flex justify-between flex-wrap">
          {timeLog?.captures.length > 1 &&
            timeLog?.captures.slice().reverse().map((item, index) => (
              <div key={index} className="w-5/12 bg-white p-2 shadow-md mb-4 rounded-lg">
                <img src={item.image} className="w-full rounded-md" alt="Work Diary" />
                <label className="relative flex items-center text-xs text-gray-600 pl-6 pt-2 cursor-pointer">
                  {moment(new Date(item.time)).format('hh:mm A')}
                  <input type="checkbox" className="hidden" />
                  <span className="absolute left-0 top-2 h-4 w-4 bg-white border border-gray-300 rounded-md"></span>
                </label>
              </div>
            ))}
        </div>
      </div> */}
    </div>
    </div>
  
  );
}

export default TimeTrackerView;
