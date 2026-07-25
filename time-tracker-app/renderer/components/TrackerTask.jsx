import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useRouter } from 'next/router';
import { setComment, setTrackerStartTime } from '../store/timelog';
import { DateTime } from 'luxon';
import { apiRequest } from '../utils/services';
import { DEFAULT_TASK_IMAGE } from '../utils/imageDefaults';
import { fetchEstimateStatus } from '../utils/estimateLimit';
import WasabiImage from './WasabiImage/WasabiImage';

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
      const taskId = selectedTaskData?.fullData?.TicketID || selectedTaskData?.fullData?._id;
      // AHE-3831 — a task needs an estimate with time left to be tracked.
      const est = await fetchEstimateStatus(currentCopany?._id, taskId);
      if (est.ok && est.blockStart) {
        setTaskModalError(est.blockMessage);
        setIsSpinner(false);
        return;
      }
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
          taskTypeImage: taskTypeImage,
          remainingMinutes: est.hasEstimate ? est.remainingMinutes : null
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
    <div className="px-2 pb-2">
      {/* Task breadcrumb + headline (mirrors the Today's Tasks row) */}
      <div
        className="truncate text-xs text-gray-500"
        title={`${selectedTaskData?.folderName || ''} ${selectedTaskData?.sprintName || ''}`}
      >
        {selectedTaskData.key} | {selectedTaskData.projectName}
        {selectedTaskData.folderName && (
          <>
            {" / "}
            <img src="/images/png/folder.png" className="w-[10px] h-[10px] mx-1 inline-block" alt="folder" />
            {selectedTaskData.folderName}
          </>
        )}
        {selectedTaskData.sprintName && ` / ${selectedTaskData.sprintName}`}
      </div>
      <p className="text-sm font-medium text-gray-800 mt-1 mb-3 flex items-center gap-1.5">
        <WasabiImage
          url={getTaskTypeImage(selectedTaskData.projectName, selectedTaskData?.fullData?.taskData?.TaskType)}
          isUser={false}
          className="!w-[16px] !h-[16px] shrink-0"
        />
        <span className="truncate" title={selectedTaskData.taskName}>{selectedTaskData.taskName}</span>
      </p>

      <textarea
        className="w-full h-[80px] rounded-[5px] border border-[#DFE1E6] resize-none px-3 py-2 outline-none text-sm"
        value={taskComment}
        onChange={e => { setTaskComment(e.target.value); setTaskModalError(''); }}
        placeholder="Comment"
      />
      {taskModalError && <div className="text-red-500 text-xs mt-1">{taskModalError}</div>}

      <div className="flex justify-end gap-3 mt-4">
        <button
          className="px-5 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 font-bold text-sm cursor-pointer"
          onClick={onClose}
          disabled={isSpinner}
        >
          Cancel
        </button>
        <button
          className="px-[25px] py-2 bg-[#1CB303] text-white rounded text-sm hover:bg-[#169302] transition-colors whitespace-nowrap cursor-pointer font-bold"
          onClick={handleStart}
          disabled={isSpinner}
        >
          {isSpinner ? 'Starting...' : 'Start Tracker'}
        </button>
      </div>
    </div>
  );
} 