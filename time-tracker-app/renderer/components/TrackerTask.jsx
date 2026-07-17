import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useRouter } from 'next/router';
import { setComment, setTrackerStartTime } from '../store/timelog';
import { DateTime } from 'luxon';
import { apiRequest } from '../utils/services';
import { DEFAULT_TASK_IMAGE } from '../utils/imageDefaults';

export default function TrackerTask({
  selectedTaskData,
  onClose,
  projects
}) {
  const dispatch = useDispatch();
  const router = useRouter();
  const currentCopany = useSelector((state) => state.company.currentCompany);
  const { user } = useSelector((state) => state.user);
  const [taskComment, setTaskComment] = useState(selectedTaskData?.comment || '');
  const [taskModalError, setTaskModalError] = useState('');
  const [isSpinner, setIsSpinner] = useState(false);

  if (!selectedTaskData) return null;

  const handleStart = async () => {
    if (!taskComment.trim()) {
      setTaskModalError('Comment is required');
      return;
    }
    setIsSpinner(true);
    try {
      window.ipc.send("start-listen-event");
      let obj = {
        userId: user?._id || "",
        projectId: selectedTaskData?.fullData?.ProjectId || selectedTaskData?.fullData?.ProjectID,
        taskId: selectedTaskData?.fullData?.TicketID || selectedTaskData?.fullData?._id,
        description: taskComment || "",
        companyId: currentCopany?._id || "",
        actionTime: Math.floor(Number(DateTime.utc().ts)/1000),
        type: "timesheets"
      };
      let url = `/api/v3/timeTracker/start`;
      const response = await apiRequest('post', url, obj);
      if (response?.data?.status) {
        dispatch(setTrackerStartTime(response.data.statusText));
        let taskTypeImage = getTaskTypeImage(selectedTaskData?.projectName,selectedTaskData?.fullData?.taskData?.TaskType)
        dispatch(setComment({
          comment: taskComment,
          sprintId : selectedTaskData?.fullData?.sprintArray?._id || selectedTaskData?.fullData?.taskData?.sprintData?.[0]?._id || selectedTaskData?.fullData?.taskData?.sprintId,
          taskId : selectedTaskData?.fullData.TicketID || selectedTaskData?.fullData?._id,
          projectId : selectedTaskData?.fullData?.ProjectId || selectedTaskData?.fullData?.ProjectID,
          taskName: selectedTaskData?.taskName,
          projectName: selectedTaskData?.projectName,
          folderName: selectedTaskData?.folderName || '',
          sprintName: selectedTaskData?.sprintName,
          taskTypeImage: taskTypeImage
        }));
        setIsSpinner(false);
        onClose();
        router.push('/trackerRunning');
      } else {
        if (response.data.isPermissionDenied) {
          setTaskModalError("You don't have permission to start the tracker.");
        } else {
          setTaskModalError('Something went wrong');
        }
        setIsSpinner(false);
      }
    } catch (error) {
      console.error(error,"IT is error");
      setIsSpinner(false);
      setTaskModalError('Something went wrong');
    }
  };

  const getTaskTypeImage = (projectName, key) => {
    let project = projects.find((x) => x.ProjectName === projectName);
    let imgUrl = DEFAULT_TASK_IMAGE;
    if (project?.taskTypeCounts?.length > 0) {
      const match = project.taskTypeCounts.find((item) => item.value === key);
      if (match?.taskImage) {
        imgUrl = match?.taskImage;
      }
    }

    return imgUrl;
  };

  return (
    <div className="flex items-center justify-center bg-[#f4f5f7] p-3 max-h-[calc(100%-130px)]">
      <div className="bg-white rounded-2xl w-full max-w-lg p-8 relative border border-gray-100 shadow-[0px_1.615384578704834px_12.115384101867676px_0px_#0000001F] flex flex-col h-[467px]">
        {/* Title */}
        {/* <h2 className="text-2xl font-semibold mb-6 text-center flex-shrink-0 cursor-pointer">Start Tracker</h2> */}
        {/* Scrollable Content */}
        <div className="flex-1 overflow-auto scrollbar-hide space-y-4">
          <div>
            <div><strong>Project</strong></div>
            <div>{selectedTaskData.projectName}</div>
          </div>
          {selectedTaskData.folderName && 
            <div>
              <div><strong>Folder</strong></div>
              <div>{selectedTaskData.folderName}</div>
            </div>
          }
          <div>
            <div><strong>Sprint</strong></div>
            <div>{selectedTaskData.sprintName}</div>
          </div>
          <div>
            <div><strong>Task</strong></div>
            <div>{selectedTaskData.key} | {selectedTaskData.taskName}</div>
          </div>
          <div>
            {/* <label className="block font-semibold mb-1">Comment:</label> */}
            <textarea
              type="text"
              className="w-full h-[90px] rounded-[5px] border border-[#DFE1E6] resize-none px-3 py-2 outline-none"
              value={taskComment}
              onChange={e => { setTaskComment(e.target.value); setTaskModalError(''); }}
              placeholder="Comment"
            />
            {taskModalError && <div className="text-red-500 text-sm mt-1">{taskModalError}</div>}
          </div>
        </div>
        {/* Button Row */}
        <div className="flex justify-end gap-3 mt-8 flex-shrink-0">
          <button
            className="px-5 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 font-bold cursor-pointer"
            onClick={onClose}
            disabled={isSpinner}
          >
            Cancel
          </button>
          <div className="w-1/2 flex justify-center">
            <button
              className="px-[25px] py-[10px] bg-[#1CB303] text-white rounded text-sm hover:bg-[#169302] transition-colors whitespace-nowrap cursor-pointer font-bold"
              onClick={handleStart}
              disabled={isSpinner}
            >
              {isSpinner ? 'Starting...' : 'Start Tracker'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 