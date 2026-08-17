import React, { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import { useDispatch, useSelector } from 'react-redux'
import TrackerSelection from '../components/TrackerSelection/TrackerSelection'
import { apiRequest } from '../utils/services'
import { useRouter } from 'next/router'
import { setComment, setTrackerStartTime } from '../store/timelog'
import moment from 'moment'
import store from '../store/store'
import Modal from '../components/Modal/Modal'
import ManualTimeEntry from '../components/ManualTimeEntry/ManualTimeEntry'
import Loader from '../components/Loader/Loader'
import { DateTime } from 'luxon';
import TrackerTask from '../components/TrackerTask';
import TaskTypeIcon from '../components/TaskTypeIcon/TaskTypeIcon'
import { fetchAndProcessProjects } from '../utils/projectUtils'
import { formatMinutes } from '../hooks/useTodayLogged'
import { DEFAULT_TASK_IMAGE } from '../utils/imageDefaults'
import { openTaskInWeb } from '../utils/taskWebLink'
import { useDeepLinkStart } from '../hooks/useDeepLinkStart'
import { fetchEstimateStatus } from '../utils/estimateLimit'

export default function HomePage() {
  const router = useRouter();
  const dispatch = useDispatch();
  const companyUser = useSelector((state) => state.company.companyUser)
  const currentCopany = useSelector((state)=> state.company.currentCompany)
  const { user } = useSelector((state) => state.user)
  
  // Get projects from store
  const { filteredProjects: projectOption, allProjects, isLoading: isProjectLoading } = useSelector((state) => state.project)

  const [isTrackerPermission, setIsTrackerPermission] = useState(true);
  const trackerRef = useRef(null);
  const [isManualTimeModalOpen, setIsManualTimeModalOpen] = useState(false);
  const [isSpinner,setIsSpinner] = useState(false);
  const isInterNetLost = useSelector((state)=> state.auth.isInternetLost);
  const [tasks, setTasks] = useState([]);
  const [taskLoggedMap, setTaskLoggedMap] = useState({}); // taskId -> minutes logged today
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedTaskData, setSelectedTaskData] = useState(null);
  const [taskComment, setTaskComment] = useState('');
  const [expandedTasks, setExpandedTasks] = useState({}); // task.key -> expanded?

  useEffect(() => {
    init();
  }, [companyUser])

  // Effect to handle tasks when projects are loaded
  useEffect(() => {
    if (projectOption.length > 0 && companyUser.isTrackerUser) {
      getTasksForList(projectOption);
    }
  }, [projectOption, companyUser.isTrackerUser])

  const init = async () => {
    if (!companyUser.isTrackerUser) {
      setIsTrackerPermission(false);
      return;
    }
    else {
      setIsTrackerPermission(true);
      
      // Check if projects are already in store
      if (allProjects.length === 0) {
        // Fetch projects if not in store
        await fetchAndProcessProjects(dispatch);
      }
    }
  }

  const getTasksForList = async (option) => {
    try {
      let ids = option.map((x) => x.value);
      let startDate = new Date(new Date().setHours(0, 0, 0)).getTime();
      let endDate = new Date(new Date().setHours(23, 59, 59)).getTime();
      const projectIDs = ids;
      let queryAndConditions = [
          {
              objId: {
                  CompanyId: currentCopany?._id,
              },
          },
          {
            AssigneeUserId: {
              $in: [user?._id]
            }
          },
          { deletedStatusKey: 0 },
          {
              ProjectID: {
                  objId: projectIDs && projectIDs.length ? { $in: projectIDs } : {},
              },
          },
          // ...(filterQuery.value ? Object.entries(filterQuery.value).map(([key, value]) => ({ [key]: value })) : [])
      ];

      let obj = [
          {
              $match: {
                  $and: queryAndConditions,
                  $or: [
                      { startDate: { dbDate: { $gte: startDate, $lte: endDate } } },
                      { DueDate: { dbDate: { $gte: startDate, $lte: endDate } } },
                      {
                          $and: [
                              { DueDate: { dbDate: { $gte: startDate } } },
                              { startDate: { dbDate: { $lte: endDate } } }
                          ]
                      }
                  ]
              }
          },
          {
              $lookup: {
                  from: 'folders',
                  localField: 'folderObjId',
                  foreignField: '_id',
                  as: 'folderArray',
                  pipeline: [
                      {
                          $project: {
                              name: 1
                          }
                      }
                  ],
              }
          },
          {
              $lookup: {
                  from: 'sprints',
                  localField: 'sprintId',
                  foreignField: '_id',
                  as: 'sprintArray',
                  pipeline: [
                      {
                          $project: {
                              name: 1,
                              folderId: 1
                          }
                      }
                  ],
              }
          },
          {
              $unwind: '$sprintArray'
          },
          {
              $unwind: { path: '$folderArray', preserveNullAndEmptyArrays: true }
          },
          { $sort: { DueDate: -1, _id: 1 } },
      ]
      const [queryRef, workedTasks] = await Promise.all([
        apiRequest('post', `/api/v1/task/find`, { findQuery: obj }),
        apiRequest('post', `/api/v1/timesheet`, {
          queryeta: [
            {
              $match: {
                $and: [
                  { Loggeduser: { $in: [user?._id] } },
                  { ProjectId: { $in: projectIDs } },
                  { LogStartTime: { $gte: (startDate / 1000), $lte: (endDate / 1000) } },
                  { logAddType: { $in: [0, 1] } }
                ]
              }
            },
            // Sort by TicketID and LogStartTime descending
            {
              $sort: {
                TicketID: 1,
                LogStartTime: -1
              }
            },
            // Group by TicketID to get only the latest log
            {
              $group: {
                _id: "$TicketID",
                doc: { $first: "$$ROOT" }
              }
            },
            // Replace root with the grouped doc
            {
              $replaceRoot: {
                newRoot: "$doc"
              }
            },
            {
              $addFields: {
                TaskId: { $toObjectId: "$TicketID" }
              }
            },
            {
              $lookup: {
                from: 'tasks',
                localField: 'TaskId',
                foreignField: '_id',
                as: 'taskData',
                pipeline: [
                  {
                    $lookup: {
                      from: 'folders',
                      localField: 'folderObjId',
                      foreignField: '_id',
                      as: 'folderArray',
                      pipeline: [
                        { $project: { name: 1 } }
                      ]
                    }
                  },
                  {
                    $lookup: {
                      from: 'sprints',
                      localField: 'sprintId',
                      foreignField: '_id',
                      as: 'sprintData',
                      pipeline: [
                        { $project: { name: 1, folderId: 1 } }
                      ]
                    }
                  }
                ]
              }
            },
            { $unwind: '$taskData' }
          ]          
        })
      ]);

      // If you want to combine the results into one array:
      const combinedResults = [
        ...(workedTasks.data || []),
        ...(queryRef.data || [])
      ];
      let finalResult = [];
      combinedResults.forEach((item) => {
        let obj = {}
        if (item.TaskName) {
          obj.taskName = item.TaskName
          obj.key = item.TaskKey
          obj.taskId = item._id
          obj.sprintName = item.sprintArray?.name || ''
          obj.folderName = item.folderArray?.name || ''
          let projectIndex = option.findIndex((x) => x.value === item.ProjectID)
          if (projectIndex !== -1) {
            obj.projectName = option[projectIndex].label
          }
        } else {
          let projectIndex = option.findIndex((x) => x.value === item.ProjectId)
          if (projectIndex !== -1) {
            obj.projectName = option[projectIndex].label
          }
          obj.taskName = item.taskData.TaskName
          obj.key = item.taskData.TaskKey
          obj.taskId = item.taskData._id || item.TicketID
          obj.sprintName = item.taskData.sprintData[0]?.name || ''
          obj.folderName = item.taskData.folderArray[0]?.name || ''
          obj.comment = item.LogDescription
        }

        obj.fullData = item;
        
        let key = finalResult.findIndex((x)=> x.key === obj.key)
        if (key === -1) {
          finalResult.push(obj);
        } else {
          if (obj.comment) {
            finalResult[key].comment = obj.comment;
          }
        }
      })
      setTasks(finalResult)

      // Today's logged minutes per task (summed across that task's logs).
      try {
        const loggedAgg = await apiRequest('post', `/api/v1/timesheet`, {
          queryeta: [
            { $match: { $and: [
              { Loggeduser: { $in: [user?._id] } },
              { LogStartTime: { $gte: (startDate / 1000), $lte: (endDate / 1000) } },
              { logAddType: { $in: [0, 1] } },
            ] } },
            { $group: { _id: "$TicketID", minutes: { $sum: "$LogTimeDuration" } } },
          ],
        });
        const map = {};
        (loggedAgg.data || []).forEach((r) => { map[String(r._id)] = r.minutes; });
        setTaskLoggedMap(map);
      } catch (e) {
        console.error("Error fetching per-task logged time:", e);
      }
    } catch (error) {
      console.error("Error fetching tasks for list:", error);
    }
  }

  const handleStartTracker = () => {
    const selectedData = trackerRef.current.getSelectedData();
    startTrackerWithData(selectedData);
  };

  const startTrackerWithData = async (selectedData) => {
    if (!selectedData) return;
    setIsSpinner(true);
    try {
      // AHE-3831 — a task needs an estimate with time left to be tracked.
      const est = await fetchEstimateStatus(currentCopany?._id, selectedData?.selectedTask?.value || "");
      if (est.ok && est.blockStart) {
        setIsSpinner(false);
        try { window.ipc.send('estimate:limit', { reason: est.blockReason, taskName: (selectedData?.selectedTask?.label || '').split(' | ')[1] || '' }); } catch (e) { /* best-effort */ }
        return;
      }
      window.ipc.send("start-listen-event");
      let obj = {
        userId: user?._id || "",
        projectId: selectedData?.selectedProject?._id || "",
        taskId: selectedData?.selectedTask?.value || "",
        description: selectedData?.comment || "",
        companyId: currentCopany?._id || "",
        actionTime: Math.floor(Number(DateTime.utc().ts)/1000),
        type: "timesheets"
      }
  
      
  
      let url = `/api/v3/timeTracker/start`;
      apiRequest('post', url, obj).then((response) => {
        if (response.data.status) {
          let taskName = selectedData?.selectedTask?.label.split(" | ")[1] || '';
          let folderName = '';
          let sprintName = '';
          if (selectedData?.selectedList?.label !== 'List') {
              let id = selectedData?.selectedList.value.split("_")[0];
              folderName = selectedData?.selectedProject?.sprintsfolders[id]?.name || '';
              if (selectedData?.selectedSprint?.value) {
                
                let idsprint = selectedData?.selectedSprint?.value.split("_")[0];
                
                sprintName = selectedData?.selectedProject?.sprintsfolders[id].sprintsObj[idsprint]?.name || '';
              }
          } else {
            let id = selectedData?.selectedList.value.split("_")[0];
            sprintName = selectedData?.selectedProject?.sprintsObj[id]?.name || '';
          }
          let taskKey = tasks.find((x)=> (x.fullData?.taskData?._id === selectedData?.selectedTask?.value) || (x.fullData?._id === selectedData?.selectedTask?.value));
          const taskTypeData = getTaskTypeData(selectedData?.selectedProject?.ProjectName, taskKey?.fullData?.taskData?.TaskType)

          dispatch(setTrackerStartTime(response.data.statusText));
          dispatch(setComment({
            comment: selectedData?.comment,
            sprintId : selectedData?.selectedSprint?.value ? selectedData?.selectedSprint?.value : selectedData?.selectedSprint?.id,
            taskId : selectedData?.selectedTask?.value,
            projectId : selectedData?.selectedProject?._id,
            taskName: taskName,
            projectName: selectedData?.selectedProject?.ProjectName,
            folderName: folderName,
            sprintName: sprintName,
            taskTypeImage: taskTypeData?.taskImage || DEFAULT_TASK_IMAGE,
            taskTypeData: taskTypeData,
            remainingMinutes: est.hasEstimate ? est.remainingMinutes : null
          }));
          setIsSpinner(false);
          router.push('/trackerRunning')
        } else {
          if (response.data.isPermissionDenied) {
            setIsTrackerPermission(false);
            setIsSpinner(false);
          } else {
            console.error('Something went wrong');
            setIsSpinner(false);
          }
        }
      }).catch((error) => {
        setIsSpinner(false);
        console.error(error);
      })
      
    } catch (error) {
      setIsSpinner(false);
    }
  };


  // Deep link (myapp://…?type=trackerStart&taskId=..&comment=..): start directly.
  // Shared with Layout (already-running prompt) via the hook.
  const handleDeepLink = useDeepLinkStart(setIsSpinner);

  const startTrackerFromTask = (task) => {
    setSelectedTaskData(task);
    setTaskComment(task.comment || '');
    setIsTaskModalOpen(true);
  }

  const toggleTaskExpand = (e, key) => {
    e.stopPropagation();
    setExpandedTasks((m) => ({ ...m, [key]: !m[key] }));
  };

  // Open a Today's-Tasks row in the web app (worked tasks wrap the doc in taskData).
  const openTaskWeb = (e, task) => {
    e.stopPropagation();
    const fd = task?.fullData || {};
    const td = fd.taskData || fd;
    openTaskInWeb({
      cid: currentCopany?._id,
      projectId: String(fd.ProjectID || fd.ProjectId || td.ProjectID || ''),
      folderObjId: td.folderObjId ? String(td.folderObjId) : '',
      sprintId: td.sprintId ? String(td.sprintId) : '',
      taskId: String(td._id || fd.TicketID || task.taskId || ''),
    });
  }

  const getTaskTypeData = (projectName, key) => {
    const project = projectOption.find((x) => x.label === projectName);
    const match = project?.taskTypeCounts?.find((item) => item.value === key);
    return match || { taskImage: DEFAULT_TASK_IMAGE };
  };

  return (
    <React.Fragment>
      <Head>
        <title>Alian hub Tracker 2.0</title>
      </Head>
      <div>
        {isSpinner && <Loader/>}
        {!isTrackerPermission ? <>
          <div className='flex justify-center items-center flex-col p-12 text-center'>
            <div><img src="/images/png/Frame.png" alt='warning' /></div>
            <div className='font-semibold text-md'>You don't have permission to use tracker. Please contact your administrator.</div>
          </div>
        </> :
        <>
            <div className="bg-[#f4f5f7] h-[calc(100vh-135px)] overflow-auto scrollbar-hide">
            <div className="flex flex-col items-center overflow-y-scroll text-sm scrollbar-hide bg-white shadow-[0px_1.615384578704834px_12.115384101867676px_0px_#0000001F] rounded-2xl mx-4 mt-2 mb-3">
              {isInterNetLost && <div className='text-red-400 text-xs pt-2'>Internet Connection Lost</div>}
              {isProjectLoading ? (
                <div className="flex justify-center items-center p-8">
                  <Loader />
                </div>
              ) : (
                <TrackerSelection
                  ref={trackerRef}
                  projectOption={projectOption}
                  onDeepLink={handleDeepLink}
                />
              )}

              {/* Action Buttons */}
              {!isProjectLoading && (
                <div className="w-full flex justify-between items-center mb-[15px] px-[15px]">
                    <div className="w-1/2">
                      <button
                        className="text-[#2F3990] underline text-sm font-medium cursor-pointer"
                        onClick={() => {
                          setIsManualTimeModalOpen(true)
                        }}
                      >
                        Add Manual Time
                      </button>
                    </div>
                    <div className="w-1/2 flex justify-end">
                      <button
                        className="px-[25px] py-[10px] bg-[#1CB303] text-white rounded text-sm hover:bg-[#169302] transition-colors"
                        onClick={handleStartTracker}
                      >
                        Start Tracker
                      </button>
                    </div>
                </div>
              )}

              {/* Screenshot Section */}

              {/* <div className="w-full mt-[2%]">
                <div className="px-[15px] flex items-center text-[#818181] mt-[15px] text-[13px] w-[94%]">
                  Latest Screen Capture
                </div>
                <div className="p-[45px_15px] w-full max-w-[94%] mx-auto bg-white rounded-[10px] mt-[5px] mb-[20px] text-center shadow-[0px_1.615384578704834px_12.115384101867676px_0px_#0000001f]">
                  <img
                    src="/images/png/no-screenshot.png"
                    alt="No Screenshot"
                    className="mx-auto mb-2.5"
                  />
                  <p className="text-xs font-normal text-[#818181]">
                    You haven't worked on this task before
                  </p>
                </div>
              </div> */}
            </div>
            {!isProjectLoading && tasks.length > 0 && (
              <div className="mx-4 mb-8">
                <div className="text-[#2F3990] font-medium mb-2 px-1">Today's Tasks</div>
                <div className="bg-white rounded-xl overflow-hidden">
                  {tasks.map((task) => {
                    const isExpanded = !!expandedTasks[task.key];
                    return (
                    <div
                      key={task.key}
                      onClick={() => startTrackerFromTask(task)}
                      className="px-4 py-2.5 cursor-pointer hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                    >
                      {/* Collapsed line: task name + open-in-web + expand */}
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-500 shrink-0">
                          <TaskTypeIcon taskType={getTaskTypeData(task.projectName, task.fullData.taskData?.TaskType)} className="!w-[15px] !h-[15px]" />
                        </span>
                        <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800" title={task.taskName}>{task.taskName}</span>
                        <button
                          type="button"
                          onClick={(e) => openTaskWeb(e, task)}
                          title="Open task in browser"
                          aria-label="Open task in browser"
                          className="shrink-0 text-gray-400 hover:text-[#2F3990] cursor-pointer bg-transparent border-0 p-0"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => toggleTaskExpand(e, task.key)}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Hide details' : 'Show details'}
                          className="shrink-0 text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-0 p-0"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      </div>

                      {/* Tracked time */}
                      <div className="mt-0.5 text-xs font-semibold text-[#2F3990] tabular-nums">
                        {taskLoggedMap[String(task.taskId)] ? `${formatMinutes(taskLoggedMap[String(task.taskId)])} hrs` : '--'}
                      </div>

                      {/* Expanded: breadcrumb + comment */}
                      {isExpanded && (
                        <div className="mt-1.5">
                          <div
                            className="truncate text-[11px] text-gray-400"
                            title={`${task?.folderName || ''} ${task?.sprintName || ''}`}
                          >
                            {task.key} | {task?.projectName && `${task?.projectName}`}
                            {task?.folderName && " / "}
                            {task?.folderName && (
                              <>
                                <img src="/images/png/folder.png" className="w-[10px] h-[10px] mx-1 inline-block" alt="folder" />
                                {task?.folderName}
                              </>
                            )}
                            {task?.sprintName && `/ ${task?.sprintName}`}
                          </div>
                          {task.comment && (
                            <p className="text-xs text-gray-700 leading-snug mt-1" title={task.comment}>{task.comment}</p>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
        }

        {/* Manual Time Entry Modal */}
        <Modal
          isOpen={isManualTimeModalOpen}
          onClose={() => setIsManualTimeModalOpen(false)}
          title="Add Manual Time"
        >
          <ManualTimeEntry onClose={() => setIsManualTimeModalOpen(false)} />
        </Modal>

        {/* Start-tracker bottom sheet (slides up over the Today's Tasks list) */}
        <Modal
          isOpen={isTaskModalOpen}
          onClose={() => {
            setIsTaskModalOpen(false);
            setSelectedTaskData(null);
          }}
          title="Start Tracker"
        >
          <TrackerTask
            selectedTaskData={selectedTaskData}
            projects={allProjects}
            onClose={() => {
              setIsTaskModalOpen(false);
              setSelectedTaskData(null);
            }}
          />
        </Modal>
      </div>
    </React.Fragment>
  )
}
