import { useDispatch, useSelector } from 'react-redux';
import { useRouter } from 'next/router';
import { DateTime } from 'luxon';
import { apiRequest } from '../utils/services';
import { setComment, setTrackerStartTime } from '../store/timelog';
import { DEFAULT_TASK_IMAGE } from '../utils/imageDefaults';
import { estimateStatusFromTask } from '../utils/estimateLimit';

// Start a tracker session from a deep link (myapp://…?taskId=&comment=).
// Fetches just what start needs (task + project/folder/sprint names), guards to
// the task's assignees, starts via /api/v3/timeTracker/start, and navigates to
// the running screen. Shared by home (idle start) and Layout (already-running
// prompt). `setLoading` is optional. Returns true on a successful start.
export function useDeepLinkStart(setLoading = () => {}) {
  const dispatch = useDispatch();
  const router = useRouter();
  const currentCompany = useSelector((s) => s.company.currentCompany);
  const { user } = useSelector((s) => s.user);
  const { filteredProjects: projectOption } = useSelector((s) => s.project);

  const getTaskTypeImage = (projectName, key) => {
    const project = (projectOption || []).find((x) => x.label === projectName);
    if (project?.taskTypeCounts?.length > 0) {
      const match = project.taskTypeCounts.find((item) => item.value === key);
      if (match?.taskImage) return match.taskImage;
    }
    return DEFAULT_TASK_IMAGE;
  };

  const start = async ({ taskId, comment }) => {
    if (!taskId) return false;
    setLoading(true);
    try {
      const res = await apiRequest('post', `/api/v1/task/find`, {
        findQuery: [
          { $match: { objId: { _id: taskId, CompanyId: currentCompany?._id } } },
          { $lookup: { from: 'projects', localField: 'ProjectID', foreignField: '_id', as: 'projectArr', pipeline: [{ $project: { ProjectName: 1 } }] } },
          { $unwind: { path: '$projectArr', preserveNullAndEmptyArrays: true } },
          { $lookup: { from: 'folders', localField: 'folderObjId', foreignField: '_id', as: 'folderArr', pipeline: [{ $project: { name: 1 } }] } },
          { $unwind: { path: '$folderArr', preserveNullAndEmptyArrays: true } },
          { $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 'sprintArr', pipeline: [{ $project: { name: 1 } }] } },
          { $unwind: { path: '$sprintArr', preserveNullAndEmptyArrays: true } },
        ],
      });
      const task = res?.data?.[0];
      if (!task) { setLoading(false); return false; }

      // Only the task's assignees may start it (deep links can be hand-crafted).
      if (!(task.AssigneeUserId || []).includes(user?._id)) {
        setLoading(false);
        console.warn('Deep-link start blocked: current user is not an assignee of the task');
        return false;
      }

      const projectId = String(task.ProjectID || '');
      const sprintId = task.sprintId ? String(task.sprintId) : '';
      const projectName = task.projectArr?.ProjectName || '';
      const folderName = task.folderArr?.name || '';
      const sprintName = task.sprintArr?.name || '';
      const taskName = task.TaskName || '';
      const description = (comment && comment.trim()) || taskName;
      const taskTypeImage = getTaskTypeImage(projectName, task.TaskType);

      // AHE-3831 — a task needs an estimate with time left to be tracked
      // (no estimate, or estimate already met, both block the start).
      const est = estimateStatusFromTask(task);
      if (est.blockStart) {
        setLoading(false);
        try { window.ipc.send('estimate:limit', { reason: est.blockReason, taskName }); } catch (e) { /* best-effort */ }
        console.warn(`Deep-link start blocked: ${est.blockReason}`);
        return false;
      }

      window.ipc.send('start-listen-event');
      const startRes = await apiRequest('post', `/api/v3/timeTracker/start`, {
        userId: user?._id || '',
        projectId,
        taskId,
        description,
        companyId: currentCompany?._id || '',
        actionTime: Math.floor(Number(DateTime.utc().ts) / 1000),
        type: 'timesheets',
      });
      if (startRes?.data?.status) {
        dispatch(setTrackerStartTime(startRes.data.statusText));
        dispatch(setComment({ comment: description, sprintId, taskId, projectId, taskName, projectName, folderName, sprintName, taskTypeImage, remainingMinutes: est.hasEstimate ? est.remainingMinutes : null }));
        setLoading(false);
        router.push('/trackerRunning');
        return true;
      }
      setLoading(false);
      console.error('Deep-link start failed', startRes?.data);
      return false;
    } catch (e) {
      setLoading(false);
      console.error('Deep-link start error', e);
      return false;
    }
  };

  return start;
}
