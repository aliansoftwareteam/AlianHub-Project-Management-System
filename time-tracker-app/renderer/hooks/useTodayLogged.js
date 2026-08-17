import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { apiRequest } from '../utils/services';

const todayRangeSec = () => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return [Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)];
};

// "HH:MM" (zero-padded), e.g. 432 min -> "07:12"
export const formatMinutes = (mins) => {
  const total = Math.max(0, Math.floor(mins));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Today's total logged minutes for the current user (all projects), ticking live
// while tracking. Saved logs already include the running session up to the last
// capture, so the active log is excluded and the live session elapsed added on top.
export function useTodayLoggedMinutes() {
  const { user } = useSelector((s) => s.user);
  const timeLog = useSelector((s) => s.timeLog);
  const [logs, setLogs] = useState([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    const fetchToday = async () => {
      if (!user?._id) return;
      const [startSec, endSec] = todayRangeSec();
      try {
        const res = await apiRequest('post', '/api/v1/timesheet', {
          queryeta: [
            { $match: { $and: [
              { Loggeduser: { $in: [user._id] } },
              { LogStartTime: { $gte: startSec, $lte: endSec } },
              { logAddType: { $in: [0, 1] } },
            ] } },
            { $project: { LogTimeDuration: 1 } },
          ],
        });
        if (active) setLogs(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        console.error('useTodayLogged fetch failed:', error);
      }
    };
    fetchToday();
    return () => { active = false; };
  }, [user?._id, timeLog.trackerStart]);

  useEffect(() => {
    if (!timeLog.trackerStart) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timeLog.trackerStart]);

  const savedMinutes = logs
    .filter((l) => !(timeLog.trackerStart && String(l._id) === String(timeLog.trackerID)))
    .reduce((sum, l) => sum + (Number(l.LogTimeDuration) || 0), 0);

  const liveMinutes = (timeLog.trackerStart && timeLog.startTime)
    ? (Date.now() - new Date(timeLog.startTime).getTime()) / 60000
    : 0;

  return savedMinutes + liveMinutes;
}
