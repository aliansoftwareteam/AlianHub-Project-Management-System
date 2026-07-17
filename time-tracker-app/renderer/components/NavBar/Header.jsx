import React, { useEffect, useState } from 'react';
const { publicRuntimeConfig } = getConfig();
import getConfig from "next/config";
import { useSelector, useDispatch } from 'react-redux'
import { fetchAndProcessProjects } from '../../utils/projectUtils'
import WasabiImage from '../WasabiImage/WasabiImage';
import TimeElapsed from '../TimeElapsed/TimeElapsed';
import { removeAllTimeLog, setTrackerStopTime } from '../../store/timelog';
const { APIURL } = publicRuntimeConfig
import { useRouter } from 'next/router';
import { TrackerController } from '../../controller/tracker/tracker';
import store from '../../store/store';
import SettingsModal from '../Settings/SettingsModal';
import Modal from '../Modal/Modal';
import { logoutFunction } from '../../controller/user/user';
import Loader from '../Loader/Loader';
import { useTodayLoggedMinutes, formatMinutes } from '../../hooks/useTodayLogged';

function Header() {
    const { user } = useSelector((state) => state.user)
    const loggedMinutes = useTodayLoggedMinutes();
    const timeLog = useSelector((state) => state.timeLog);
    const { isAuthenticated } = useSelector((state) => state.auth);
    const router = useRouter();
    const dispatch = useDispatch();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isSpinner,setIsSpinner] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    async function refreshData() {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            await fetchAndProcessProjects(dispatch, true); // reloads projects; home re-derives tasks
        } catch (error) {
            console.error('Refresh failed:', error);
        } finally {
            setIsRefreshing(false);
        }
    }
    const timeLogRef = React.useRef(timeLog);

    useEffect(() => {
        timeLogRef.current = timeLog;
    }, [timeLog]);

    function miniMizeWindow() {
        if (!window.ipc) {
            console.error('IPC is not available in renderer');
            return;
        }
        try {
            window.ipc.send('minimize-app');
        } catch (error) {
            console.error('Error sending minimize message:', error);
        }
    }

    function closeWindow() {
        if (!window.ipc) {
            console.error('IPC is not available in renderer');
            return;
        }

        try {
            if (timeLogRef.current.trackerStart) {
                TrackerController.TrackerStop().then(response=>{
                  store.dispatch(setTrackerStopTime());
                  store.dispatch(removeAllTimeLog());
                  router.push('/home');
              }).catch(error=>{
                  store.dispatch(setTrackerStopTime());
              })
            }
            window.ipc.send('close-app', "Test");
        } catch (error) {
            console.error('Error sending minimize message:', error);
        }
    }

    function trackerStop() {
        if (timeLog.trackerStart) {
            setIsSpinner(true);
            TrackerController.TrackerStop().then(response=>{
                store.dispatch(setTrackerStopTime());
                store.dispatch(removeAllTimeLog())
                setIsSpinner(false);
                router.push('/home');
            }).catch(error=>{
                store.dispatch(setTrackerStopTime());
                setIsSpinner(false);
                router.push('/home');
            })
        }
    }

    function logout() {
        if (timeLog.trackerStart) {
            TrackerController.TrackerStop().then(response=>{
                store.dispatch(setTrackerStopTime());
                store.dispatch(removeAllTimeLog())
            }).catch((error)=>{
                console.error(error);
                store.dispatch(setTrackerStopTime());
            })
        }
        setIsSettingsOpen(false)
        logoutFunction()
        .then(() => {
            router.push('/login');
        })
        .catch((error) => {
            console.error("ERROR: ", error);
        });
    }

    return (
        <div className="bg-[#2F3990] shadow-[0px_0px_16px_rgba(0,0,0,0.1)] rounded-[5px_5px_20px_20px] sticky top-0 z-2 drag-region">
            {isSpinner && <Loader/>}
            <div className="flex justify-between items-center h-[45px] mb-0 pl-[15px]">
                {/* Logo and Title Section */}
                <div className="moveApp flex items-center flex-row text-white text-sm">
                    <img
                        src={`${APIURL}/api/v1/getLogo?key=logo&type=desktop`}
                        className="h-[26px] w-[26px]"
                        alt="Logo"
                    />
                    <span className="ml-[5px] text-white">Time Tracker</span>
                </div>

                {/* Window Controls */}
                <div className="flex items-center">
                    <button
                        className="header-btn btn w-[35px] h-[35px] leading-[5px] bg-transparent hover:bg-white/30 flex justify-center items-center no-drag"
                        onClick={() => { miniMizeWindow() }}
                    >
                        <img src="/images/png/mini-squre.png" alt="Minimize" />
                    </button>
                    <button
                        className="header-btn-red btn w-[35px] h-[35px] leading-[5px] bg-transparent hover:bg-red-500 flex justify-center items-center no-drag"
                        onClick={() => { closeWindow() }}
                    >
                        <img src="/images/png/close.png" alt="Close" />
                    </button>
                </div>
            </div>

            {/* Settings Modal */}
            <Modal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                title="Work Spaces"
            >
                <SettingsModal  onLogout={() => logout()}/>
            </Modal>

            {isAuthenticated && (
                <div className="leading-normal cursor-default px-[15px] py-[10px]">
                    <div className="flex items-center justify-between text-white">
                        <div className="flex flex-col leading-none min-w-0" title="Logged today">
                            <span className="text-[10px] opacity-80">Logged today</span>
                            <span className="text-[26px] font-normal leading-tight tabular-nums">
                                {formatMinutes(loggedMinutes)}<span className="text-[16px] font-normal opacity-80 ml-1">hrs</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                            <button
                                type="button"
                                onClick={refreshData}
                                disabled={isRefreshing}
                                title="Refresh"
                                className="no-drag cursor-pointer text-white/80 hover:text-white disabled:opacity-60 flex items-center justify-center"
                            >
                                <svg className={isRefreshing ? 'animate-spin' : ''} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                                    <path d="M21 3v6h-6" />
                                </svg>
                            </button>
                            <div className="cursor-pointer no-drag" onClick={() => setIsSettingsOpen(true)} title={`${user?.Employee_Name || ''} — Settings`}>
                                <WasabiImage url={user?.Employee_profileImageURL} isUser={true} thumbnail="35x35" className='w-[34px] h-[34px] rounded-full shrink-0 ring-2 ring-white/40' />
                            </div>
                        </div>
                    </div>

                    {timeLog.trackerStart && (
                        <div>
                            <div className="shadow-md rounded-xl bg-[#FFFFFF33] bg-opacity-50 p-3 mt-4 flex items-center">
                                {/* <div className="w-[5%] h-4">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="9"
                                        height="16"
                                        viewBox="0 0 9 16"
                                        fill="none"
                                    >
                                        <path
                                            fillRule="evenodd"
                                            clipRule="evenodd"
                                            d="M8.69767 15.6417C8.89276 15.4468 9.00023 15.1874 9.00023 14.9115C9.00023 14.6355 8.89276 14.3761 8.69767 14.1814L2.49174 7.97144L8.69651 1.76171C8.89176 1.56682 8.99937 1.30741 8.99937 1.03133C8.99937 0.755248 8.89262 0.495856 8.69651 0.300336C8.29429 -0.101888 7.63904 -0.101888 7.23596 0.300544L0.299745 7.24085C0.107254 7.43413 0.00122514 7.69331 0.00122512 7.97083C0.00122512 7.97083 0.00122512 7.97083 0.00122512 7.97102C0.00122511 8.24915 0.107686 8.50875 0.301051 8.70162L7.23667 15.6419C7.63904 16.0433 8.29429 16.0433 8.69767 15.6417Z"
                                            fill="white"
                                        />
                                    </svg>
                                </div> */}
                                <div className="pl-2 w-[95%]">
                                    <ul className="p-0 m-0 flex items-center">
                                        <li className="text-white text-sm font-normal mr-4 relative">
                                            <span className="block overflow-hidden text-ellipsis text-left break-all ">
                                                {timeLog?.projectName && `${timeLog?.projectName}`}
                                                {timeLog?.folderName && "/"} {timeLog?.folderName && (
                                                    <img
                                                        src="/images/png/folder.png"
                                                        className="w-[10px] inline-block"
                                                        alt="folder"
                                                    />
                                                )} {timeLog?.folderName}
                                                {timeLog?.sprintName && `/${timeLog?.sprintName}`}
                                            </span>
                                        </li>
                                    </ul>
                                    <div className="flex items-center leading-none text-white overflow-hidden text-ellipsis whitespace-nowrap">
                                        {/* <img src={project?.selectedTaskType} className="h-4 w-4" alt="task type" /> */}
                                        {timeLog?.taskTypeImage && <WasabiImage url={timeLog?.taskTypeImage} isUser={false} className="!w-[15px] !h-[15px]" />}
                                        <span className="ml-2 font-medium text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                                            {timeLog?.taskName}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-between mt-2">
                                <div className="text-left pt-2 pb-1">
                                    <p className="text-gray-400 text-xs leading-[18px] m-0">Current Session</p>
                                    <TimeElapsed time={new Date(timeLog?.startTime)} />
                                </div>
                                <div className="flex items-center no-drag">
                                    {timeLog?.trackerStart ? (
                                        <img
                                            src="/images/svg/pushbtn.svg"
                                            onClick={() => {
                                                trackerStop();
                                            }}
                                            className="cursor-pointer w-9"
                                            alt="pause"
                                        />
                                    ) : (
                                        <img src="/images/svg/playbtn.svg" className="w-9" alt="play" />
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            )}
        </div>
    );
}

export default Header;