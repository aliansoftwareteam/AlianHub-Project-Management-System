import { apiRequest } from '../../utils/services';
import store from '../../store/store';
import { DateTime } from 'luxon';
import { removeExtraClicks } from '../../store/timelog';

export const TrackerController = {
  ScreenShotCapture: async (image, previousTime, strokesData = []) => {
    try {
      const strokes = strokesData;
      const now = DateTime.utc();
      const modifiedDateTime = now.set({ seconds: 0 });
      
      const obj = {
        userId: store.getState().user?.user?._id || "",
        projectId: store.getState().timeLog?.projectId || "",
        taskId: store.getState().timeLog?.taskId || "",
        description: store.getState().timeLog?.comment || "",
        companyId: store.getState()?.company.currentCompany._id || "",
        trackerID: store.getState()?.timeLog?.trackerID || "",
        key: Math.max((store.getState()?.timeLog.captures?.length || 0) - 1, 0),
        sprint: store.getState().timeLog?.sprintId || "",
      };



      const imageName = `${new Date().getTime()}.png`;
      const formData = new FormData();
      formData.append("strokes", JSON.stringify(strokes));
      formData.append("companyId", obj.companyId);
      formData.append("timeSheetId", obj.trackerID);
      formData.append("imageName", imageName);
      formData.append("prevscreenShot", previousTime);
      formData.append("memoName", obj.description);
      formData.append("screenShotTime", modifiedDateTime.ts);
      formData.append("key", obj.key);
      formData.append("type", "timesheets");
      formData.append("projectId", obj.projectId);
      formData.append("path", `Project/${obj.projectId}/Sprint/${obj.sprint}/TimeLog/${obj.trackerID}/${imageName}`);
      formData.append("file", image);
      formData.append("actionTime",Math.floor(Number(DateTime.utc().ts)/1000));
      
      // return { status: false, message: 'Test' };
      const url = `/api/v4/timeTracker/capture`;
      const response = await apiRequest('post', url, formData, 'form');
      
      if (response.data.status) {
        store.dispatch(removeExtraClicks());
        return response.data;
      } else {
        if (response.data.isPermissionDenied) {
          return { status: false, isPermissionDenied: true };
        } else {
          return { status: false, message: "Something went wrong to capture tracker" };
        }
      }
    } catch (e) {
      return { status: false, message: e.message };
    }
  },

  manageStrokesData: () => {
    const strokes = JSON.parse(JSON.stringify(store.getState()?.timeLog.keyboardClicks));
    const strokesData = [];
    if (strokes.length > 0) {
      strokes.forEach(item => {
        
        const parsedDateTime = DateTime.fromMillis(item.time, { zone: 'utc' });
        const utcTimestamp = parsedDateTime.toMillis();
        strokesData.push({ [utcTimestamp]: { keyboard: item.keyboard || 0, mouse: item.mouse || 0 } });
      });
    }
    return strokesData;
  },

  TrackerStop: async () => {
    try {
      window.ipc.send("trackerStop");
      window.ipc.send("stop-listen-event");
      const axiosData = {
        companyId: store.getState()?.company.currentCompany._id || "",
        timeSheetId: store.getState()?.timeLog?.trackerID || "",
        userName: store.getState()?.user?.user?.Employee_Name || "",
        userId: store.getState()?.user?.user?._id || "",
        sprintId: store.getState().timeLog?.sprintId || "",
        projectId: store.getState().timeLog?.projectId || "",
        taskId: store.getState().timeLog?.taskId || "",
        taskName: store.getState().timeLog?.taskName || "N/A",
        projectName: store.getState().timeLog?.projectName || "",
        companyOwnerId: store.getState()?.company.currentCompany?.userId || "N/A",
        dateFormat: "DD-MM-yyyy",
        timeZone: "Time_Zone" in store.getState()?.user?.user ? store.getState()?.user?.user?.Time_Zone : "Asia/Kolkata",
        strokes: TrackerController.manageStrokesData(),
        actionTime: Math.floor(Number(DateTime.utc().ts)/1000),
      };
      const url = `/api/v2/timeTracker/end`;
      const response = await apiRequest('post', url, axiosData);
      if (response.data.status) {
        return response.data;
      } else {
        if (response.data.isPermissionDenied) {
          return { status: false, isPermissionDenied: true };
        } else {
          return { status: false, message: "Something went wrong to end tracker" };
        }
      }
    } catch (e) {
      return { status: false, message: e.message };
    }
  }
};
