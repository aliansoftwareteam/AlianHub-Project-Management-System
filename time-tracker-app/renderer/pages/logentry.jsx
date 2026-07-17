import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import moment from 'moment';
import store from '../store/store';
import { apiRequest } from '../utils/services';
import TrackerTask from '../components/TrackerTask';
import WasabiImage from '../components/WasabiImage/WasabiImage';
import { fetchAndProcessProjects } from '../utils/projectUtils';
import { DEFAULT_TASK_IMAGE } from '../utils/imageDefaults';

const LogEntryView = () => {
  const dispatch = useDispatch();
  const [timeSheetData, setTimeSheetData] = useState([]);
  const [totalHours, setTotalHours] = useState(0);
  const [estimateHours, setEstimateHours] = useState([]);
  const [isError, setIsError] = useState(false);
  const companyUser = useSelector((state) => state.company.companyUser)
  const currentCopany = useSelector((state)=> state.company.currentCompany)
  const [trackerStartData,setTrackerStartData] = useState([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  // Get projects from store
  const { allProjects: projectAll, isLoading: isProjectLoading } = useSelector((state) => state.project)
  const user = useSelector((state) => state.user.user);

  useEffect(() => {
    if (companyUser?.isTrackerUser) {
      init();
      setIsError(false);
    } else {
      init();
      setIsError(true);
    }
  }, [companyUser]);

  const init = async () => {
    try {
      // Check if projects are already in store
      if (projectAll.length === 0) {
        // Fetch projects if not in store
        await fetchAndProcessProjects(dispatch);
      }
      
      const response = await getLogEntryDetails();
      if (response.timeSheet.status) {
        const tempCount = response.timeSheet.data.reduce((total, item) => {
          const entrySum = item?.logEntryDetails?.reduce((n, d) => n + d.LogTimeDuration, 0) || 0;
          return total + entrySum;
        }, 0);
        setTimeSheetData(response.timeSheet.data);
        setTotalHours(tempCount);
      } else {
        setTimeSheetData([]);
        setTotalHours(0);
      }

      if (response.estimate.status) {
        setEstimateHours(response.estimate.data);
      } else {
        setEstimateHours([]);
      }
    } catch (error) {
      console.error(error);
      
      setTimeSheetData([]);
      setTotalHours(0);
      setEstimateHours([]);
    }
  };

  const getLogEntryDetails = async () => {
    try {
      // --- Fetch timeSheetData ---
      const userId = user?._id || "";
      const companyId = currentCopany?._id || "";
      
      let s_date = new Date().setHours(0, 0, 0, 0);

      let obj = {
        userId,
        companyId,
        startDate: s_date,
      };

      // 1. Get time logs
      let timeLogs = [];
      try {
        const timeLogRes = await apiRequest('post', '/api/v2/timeTracker/timelog', obj);
        
        if (timeLogRes.data.status) {
          timeLogs = timeLogRes.data.data;
        }
      } catch (error) {
        console.error(error,"IT is error");
        
        // If this fails, return error for timeSheet
        return {
          timeSheet: { status: false, message: error.message },
          estimate: { status: false, message: 'Skipped due to timeSheet error' }
        };
      }

      // 2. Get unique TicketIDs
      const taskIds = [...new Set(timeLogs.map(itm => itm.TicketID))];

      // 3. Get task details
      let tasks = [];
      if (taskIds.length > 0) {
        try {
          const taskObj = {
            findQuery: [{
              "$match": {
                _id: { objId: { $in: taskIds } }
              }
            }]
          };
          const taskRes = await apiRequest('post', '/api/v1/task/find', taskObj);
          if (taskRes?.data?.length > 0) {
            tasks = taskRes.data.map(item => ({ ...item, id: item._id }));
          }
        } catch (error) {
          // If this fails, return error for timeSheet
          return {
            timeSheet: { status: false, message: error.message },
            estimate: { status: false, message: 'Skipped due to timeSheet error' }
          };
        }
      }

      // 4. Combine logs and tasks
      let timeSheetData = [];
      if (tasks.length > 0) {
        tasks.forEach(item => {
          const timeLog = timeLogs.filter(itm => itm.TicketID === item.id);
          timeSheetData.push({ ...item, logEntryDetails: timeLog });
        });
      }

      // --- Fetch EstimateHours ---
      let estimateHours = [];
      try {
        const estimateRes = await apiRequest('post', '/api/v1/estimatedTime', {
          queryeta: [
            {
              $match: {
                userId: userId,
                Date: {
                  dbDate: {
                    $gte: new Date(new Date().setHours(0, 0, 0, 0)),
                    $lte: new Date(new Date().setHours(23, 59, 59))
                  }
                }
              }
            }
          ]
        });
        estimateHours = estimateRes?.data || [];
      } catch (error) {
        // If this fails, just return empty estimate
        estimateHours = [];
      }

      // --- Return in the same structure as before ---
      return {
        timeSheet: { status: true, data: timeSheetData },
        estimate: { status: true, data: estimateHours }
      };
    } catch (e) {
      console.error(e);
      
      return {
        timeSheet: { status: false, message: e.message },
        estimate: { status: false, message: e.message }
      };
    }
  };

  const secondsToHmsCount = (seconds) => {
    const minsNum = parseFloat(seconds);
    const hours = Math.floor(minsNum / 60);
    const minutes = Math.floor((minsNum % 60));
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  };

  const getTaskTypeImage = (project, key) => {
    let imgUrl = DEFAULT_TASK_IMAGE;
    if (project?.taskTypeCounts?.length > 0) {
      const match = project.taskTypeCounts.find((item) => item.key === key);
      if (match?.taskImage) {
        imgUrl = match?.taskImage;
      }
    }
    return imgUrl;
  };


  const trackerStartFill = (data) => {
    let obj = {
      comment: data.fullData.logEntryDetails[data.fullData.logEntryDetails.length - 1].LogDescription,
      folderName: data.folderName,
      key: data.fullData.TaskKey,
      projectName: data.projectName,
      sprintName: data.sprintName,
      taskName: data.taskName,
      fullData: {...data.fullData.logEntryDetails[data.fullData.logEntryDetails.length - 1], taskData: data.fullData}
    }
    setTrackerStartData(obj);
    setIsTaskModalOpen(true);
  }

  return (
    <React.Fragment>
      {isError ? (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <img src="/images/png/Frame.png" alt="warning" />
          <div className="font-semibold text-md mt-2">
            You don't have permission to use tracker. Please contact your administrator.
          </div>
        </div>
      ) : (
        <>
          {!isTaskModalOpen && <div className="p-4">
            <div className="flex flex-row justify-between border-b border-gray-300 pb-3 mb-4">
              <div className="text-center w-full sm:w-1/2">
                <h5 className="text-xl font-bold">{secondsToHmsCount(totalHours)}</h5>
                <p className="text-xs text-gray-500 mt-1">Today's Total Logged hours</p>
              </div>
              <div className="text-center w-full sm:w-1/2">
                <h5 className="text-xl font-bold">
                  {secondsToHmsCount(
                    estimateHours.reduce((sum, { EstimatedTime }) => sum + EstimatedTime, 0)
                  )}
                </h5>
                <p className="text-xs text-gray-500 mt-1">Today's Total Estimated hours</p>
              </div>
            </div>

            {timeSheetData.length > 0 && timeSheetData.map((item) => {
              
              const project = projectAll.find((proj) => proj._id === item.ProjectID) || {};
              const projectName = project?.ProjectName || '';
              const folderName = item?.sprintArray?.folderName || '';
              const sprintName = item?.sprintArray?.name || '';
              const taskName = item?.TaskName || '';
              const taskType = item?.TaskTypeKey || '';

              return (
                <div className="mb-5 bg-white rounded-lg" key={item.id}>
                  <div className="flex items-center justify-between border-b border-gray-300 px-4 py-2">
                    <div className='mr-2.5 cursor-pointer' onClick={()=> trackerStartFill({projectName,folderName,sprintName,taskName,fullData:item})}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25" fill="none">
                        <path d="M12.4999 0.00012207C5.59988 0.00012207 -0.00012207 5.60012 -0.00012207 12.5001C-0.00012207 19.4001 5.59988 25.0001 12.4999 25.0001C19.3999 25.0001 24.9999 19.4001 24.9999 12.5001C24.9999 5.60012 19.3999 0.00012207 12.4999 0.00012207ZM9.37488 18.1251V6.87512L18.1249 12.5001L9.37488 18.1251Z" fill="#CFCFCF"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <ul className="p-0 m-0">
                        <li className="list-none text-xs text-gray-500 truncate" title={`${folderName || ''} ${sprintName || ''}`}>
                          {item.TaskKey} / {projectName}
                          {folderName && (
                            <>
                              {' '}
                              /<img src="/images/png/folder.png" className="inline-block w-3 h-3 mx-1" alt="folder" />
                              {folderName}
                            </>
                          )}
                          {sprintName && ` / ${sprintName}`}
                        </li>
                      </ul>
                      <div className="flex items-center mt-1">
                        <WasabiImage url={getTaskTypeImage(project, taskType)} isUser={false} className="!w-[15px] !h-[15px]" />
                        <h4 className="ml-2 font-medium text-sm truncate">{taskName}</h4>
                      </div>
                    </div>
                    <div className="text-right w-16 font-medium text-sm">
                      {secondsToHmsCount(item.logEntryDetails.reduce((n, d) => n + d.LogTimeDuration, 0))}
                    </div>
                  </div>
                  <div>
                    {item.logEntryDetails.map((entry, idx) => (
                      <div key={idx} className="flex justify-between px-4 py-2 border-b border-gray-200 last:border-b-0">
                        <div>
                          {moment(entry.LogStartTime * 1000).format('hh :mm A')} - {moment(entry.LogEndTime * 1000).format('hh :mm A')}
                        </div>
                        <div>{secondsToHmsCount(entry.LogTimeDuration)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>}
          {isTaskModalOpen && (
            <TrackerTask
              selectedTaskData={trackerStartData}
              projects={projectAll}
              onClose={() => {
                setIsTaskModalOpen(false);
                setTrackerStartData(null);
              }}
            />
          )}
        </>
      )}
    </React.Fragment>
  );
};

export default LogEntryView;
