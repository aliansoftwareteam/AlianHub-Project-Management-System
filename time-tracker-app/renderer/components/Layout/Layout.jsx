import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useSelector, useDispatch } from 'react-redux';
import { initializeAuth, setInternetLost, setShowOfflineQueueScreen } from '../../store/authSlice';
import { getUserData } from '../../controller/user/user';
import Header from '../NavBar/Header';
import Footer from '../Footer/Footer';
import { getAssignCompanyData } from '../../controller/company/company';
import { TrackerController } from '../../controller/tracker/tracker';
import { removeAllTimeLog, setTrackerStopTime } from '../../store/timelog';
import { useDeepLinkStart } from '../../hooks/useDeepLinkStart';
import { getQueue, removeFirstFromQueue, objectToFormData } from '../../utils/apiQueue';
import { apiRequest, apiRequestFormData, apiRequestWithoutCompnay, apiRequestWithoutSecure } from '../../utils/services';
import store from '../../store/store';
const publicRoutes = ['/login']; // Add any public routes here

const Layout = ({ children }) => {
  const router = useRouter();
  const dispatch = useDispatch();
  const { isAuthenticated, isInitialized } = useSelector((state) => state.auth);
  const timeLog = useSelector((state)=> state.timeLog);
  const timeLogRef = React.useRef(timeLog);
  const showOfflineQueueScreen = useSelector((state) => state.auth.showOfflineQueueScreen);
  const showOflineLogout = useSelector(state => state.auth.showOflineLogout);
  const isInternetLost = useSelector((state) => state.auth.isInternetLost);
  const intervalRef = useRef(null);
  const startFromDeepLink = useDeepLinkStart();
  // Deep link that arrived while a tracker is already running — prompt the user.
  const [deepLinkPrompt, setDeepLinkPrompt] = useState(null); // { taskId, comment }

  useEffect(() => {
    timeLogRef.current = timeLog;
  }, [timeLog]);

  // Deep link while ALREADY tracking: TrackerSelection (home) isn't mounted, so
  // handle it here. Not-tracking links are handled by home/TrackerSelection.
  useEffect(() => {
    const handleTrackerInfoFill = (payload) => {
      try {
        const raw = payload?.url || '';
        const qs = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
        const params = new URLSearchParams(qs);
        const taskId = params.get('taskId') || '';
        const comment = params.get('comment') || '';
        if (!taskId) return;
        // Only intercept when a session is running; otherwise let home handle it.
        if (timeLogRef.current.trackerStart) {
          setDeepLinkPrompt({ taskId, comment });
        }
      } catch (e) {
        console.error(e);
      }
    };
    const unsubscribe = window.ipc.on('trackerInfoFill', handleTrackerInfoFill);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Prompt actions: stop the current session then start the deep-linked task.
  const stopAndStartDeepLink = async () => {
    const link = deepLinkPrompt;
    setDeepLinkPrompt(null);
    if (!link) return;
    try {
      await TrackerController.TrackerStop();
    } catch (e) {
      // Stop failed (offline etc.) — still tear down local state below so the
      // new session doesn't inherit the previous session's captures/clicks.
      console.error('Deep-link stop failed', e);
    }
    // Always clear old session state before starting the new one.
    store.dispatch(setTrackerStopTime());
    store.dispatch(removeAllTimeLog());
    const started = await startFromDeepLink(link);
    // If the new start failed, the old session is already gone — return home so
    // the user isn't stranded on a stale running screen.
    if (!started) router.push('/home');
  };

  useEffect(() => {
    dispatch(initializeAuth());
  }, [dispatch]);

  useEffect(() => {
    if (isInitialized) {
      const isPublicRoute = publicRoutes.includes(router.pathname);
      
      if (!isAuthenticated && !isPublicRoute) {
        router.push('/login');
      } else if (isAuthenticated && isPublicRoute) {
        router.push('/home');
      }

      if (isAuthenticated) {
        getUserData(dispatch).then(()=>{
          getAssignCompanyData().catch((error)=>{
            console.error("Error getting Company Data",error);
          })
        }).catch((error)=>{
          console.error(error);
        })
      }
    }
  }, [isAuthenticated, isInitialized, router.pathname]);


  useEffect(()=>{
    window.ipc.on('stop-tracker', () => {
      if (timeLogRef.current.trackerStart) {
        TrackerController.TrackerStop().then(response=>{
          store.dispatch(setTrackerStopTime());
          store.dispatch(removeAllTimeLog());
          router.push('/home');
      }).catch(error=>{
          store.dispatch(setTrackerStopTime());
      })
      }
    });
    return () => {
    window.ipc.removeAll('stop-tracker');
    }
  },[])

  // AHE-3835 — report the actively-tracked task to main so the "tracking stopped"
  // alert can name it (lock/sleep) and offer one-click resume. Read-only; does
  // not affect tracking behaviour.
  useEffect(() => {
    if (timeLog.trackerStart && timeLog.taskId) {
      window.ipc.send('tracker:context', {
        taskId: timeLog.taskId,
        taskName: timeLog.taskName || '',
        comment: timeLog.comment || '',
      });
    }
  }, [timeLog.trackerStart, timeLog.taskId]);

  const replayQueue = async () => {
    const queue = await getQueue();
    for (const req of queue) {
      try {
        if (req.method === 'apiRequest') {
          if (req.endPoint === '/api/v4/timeTracker/capture' || req.endPoint === '/api/v2/timeTracker/end' || req.endPoint === '/api/v3/timeTracker/start') {
            req.data.considerActionTime = true;
            await apiRequest(req.type, req.endPoint, req.data, req.dataType);
          } else {
          }
        } else if (req.method === 'apiRequestFormData') {
          let replayData = req.data;
          if (req.dataType === 'form') {
            replayData = objectToFormData(req.data);
          }
          await apiRequestFormData(req.type, req.endPoint, replayData, req.dataType);
        } else if (req.method === 'apiRequestWithoutCompnay') {
          await apiRequestWithoutCompnay(req.type, req.endPoint, req.data);
        } else if (req.method === 'apiRequestWithoutSecure') {
          await apiRequestWithoutSecure(req.type, req.endPoint, req.data, req.dataType);
        }
        await removeFirstFromQueue();
      } catch (e) {
        // If still offline, break and try again later
        if (!navigator.onLine) break;
      }
    }
    store.dispatch(setInternetLost(false));
    if (store.getState().auth.showOfflineQueueScreen) {
      store.dispatch(setShowOfflineQueueScreen(false));
      if (store.getState().auth.showOflineLogout === false) {
        getUserData(dispatch).then(()=>{
          getAssignCompanyData().catch((error)=>{
            console.error("Error getting Company Data",error);
          })
        }).catch((error)=>{
          console.error(error);
        })
      }
    }
  };

  useEffect(() => {
    if (isInternetLost) {
      if (!intervalRef.current) {
        intervalRef.current = setInterval(async () => {
          const online = await ping();
          if (online) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            replayQueue();
          }
        }, 30000); // 1 minute
      }
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isInternetLost]);

  useEffect(() => {
    const handler = (e) => {
      // For Windows/Linux: Ctrl+Shift+R, for Mac: Cmd+Shift+R
      if (
        (e.ctrlKey && e.shiftKey && e.key === 'R') ||
        (e.metaKey && e.shiftKey && e.key === 'R')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler);
    
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const ping = async () => {
    try {
      const response = await fetch("https://clients3.google.com/generate_204", {
        method: "GET",
        mode: "no-cors",
      });
  
      return response ? true : false;
    } catch {
      return false;
    }
  };

  // Show loading state while checking authentication
  if (!isInitialized) {
    return <div>Loading...</div>;
  }

  // return children;
  return (
    <div>
      {showOfflineQueueScreen && (
        <div className="fixed inset-0 flex items-center justify-center bg-white z-50">
          <div className="text-center">
            <img src="/images/png/Frame.png" alt="warning" className="mx-auto mb-4" />
            <div className="font-semibold text-md mb-2">Internet connection is lost. Check your connection.</div>
            {showOflineLogout && <div className="text-sm text-gray-500">You have unsynced data. Please reconnect to the internet before logging out.</div>}
            <div className='' onClick={()=> window.location.reload()}>
              <button
                className="px-[25px] py-[10px] bg-[#1CB303] text-white rounded text-sm hover:bg-[#169302] transition-colors mt-2.5"
                onClick={()=> window.location.reload()}
              >
                Check Connection
              </button>
            </div>
          </div>
        </div>
      )}
        <Header />
        <div>{children}</div>
        {isAuthenticated && !timeLog.trackerStart && <Footer />}
        {/* {this.state.showFooter && <Footer />} */}

        {/* Deep link arrived while a tracker is already running. */}
        {deepLinkPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-lg">
              <div className="text-base font-semibold text-gray-800">A tracker is already running</div>
              <p className="text-sm text-gray-600 mt-2">
                Do you want to stop the current session and start the new task, or keep the current one running?
              </p>
              <div className="flex justify-end gap-3 mt-5">
                <button
                  type="button"
                  className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 font-medium text-sm cursor-pointer"
                  onClick={() => setDeepLinkPrompt(null)}
                >
                  Keep current
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded bg-[#1CB303] text-white hover:bg-[#169302] font-medium text-sm cursor-pointer"
                  onClick={stopAndStartDeepLink}
                >
                  Stop &amp; start new
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  )
};

export default Layout; 