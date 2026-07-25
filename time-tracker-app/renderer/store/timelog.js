import { createSlice } from '@reduxjs/toolkit';

const timeLog = createSlice({
  name: 'timeLog',
  initialState: {
    comment: "",
    startTime: null,
    stopTime: null,
    captures: [],
    keyboardClicks: [],
    applicationDetails: [],
    mouseClicks: [],
    trackerStart: false,
    trackerID: "",
    sprintId: "",
    taskId: "",
    projectId: "",
    taskName: "",
    projectName: "",
    folderName: "",
    sprintName: "",
    // AHE-3831 — minutes of tracking left before this task hits its estimate,
    // captured at session start. `null` = no cap (task has no estimate).
    remainingMinutes: null
  },
  reducers: {
    setComment: (state, action) => {
      state.comment = action.payload.comment;
      state.sprintId = action.payload.sprintId;
      state.taskId = action.payload.taskId;
      state.projectId = action.payload.projectId;
      state.taskName = action.payload.taskName;
      state.projectName = action.payload.projectName;
      state.folderName = action.payload.folderName;
      state.sprintName = action.payload.sprintName;
      state.taskTypeImage = action.payload.taskTypeImage
      state.remainingMinutes = action.payload.remainingMinutes ?? null
    },
    setTrackerStartTime: (state, action) => {
      
      state.startTime = new Date().toISOString()
      state.trackerStart = true
      
      state.trackerID=action.payload
    },
    setTrackerStopTime: (state, action) => {
      state.stopTime = new Date().toISOString()
      state.trackerStart = false
    },
    setCaptures: (state, action) => {
      state.captures = [...state.captures,{...action.payload}]
    },
    // One activity "tick" = one second of detected input, classified by the
    // desktop sampler as 'mouse' (cursor moved) or 'keyboard' (input, no cursor
    // movement). Ticks are bucketed per minute into { time, keyboard, mouse } —
    // the same shape older timesheets use — over a 60-second window.
    setActivityTick: (state, action) => {
      if (!state.trackerStart) return;

      const key = action.payload && action.payload.type === 'mouse' ? 'mouse' : 'keyboard';
      const now = new Date().getTime();
      const last = state.keyboardClicks.length > 0
        ? state.keyboardClicks[state.keyboardClicks.length - 1]
        : null;
      const withinSameMinute = last && Math.abs(now - new Date(last.time).getTime()) <= 60000;

      if (withinSameMinute) {
        state.keyboardClicks = state.keyboardClicks.map((itm, ind) =>
          ind === state.keyboardClicks.length - 1
            ? { ...itm, [key]: (itm[key] || 0) + 1 }
            : { ...itm }
        );
      } else {
        state.keyboardClicks = [...state.keyboardClicks, { time: now, keyboard: key === 'keyboard' ? 1 : 0, mouse: key === 'mouse' ? 1 : 0 }];
      }
    },
    removeExtraClicks:(state)=>{
      var obj=[...state.keyboardClicks];
      obj = obj.slice(-1);
      state.keyboardClicks = [...obj]
    },
    removeAllTimeLog: (state, action) => {
      state.comment = ""
      state.startTime = null
      state.stopTime = null
      state.captures = []
      state.keyboardClicks = []
      state.applicationDetails = []
      state.mouseClicks = []
      state.trackerStart = false
      state.trackerID = ""
      state.sprintId = "";
      state.taskId = "";
      state.projectId = "";
      state.taskName = "";
      state.projectName = "";
      state.folderName = "";
      state.sprintName = "";
      state.remainingMinutes = null;
    }

  },
});

export const { setComment, setTrackerStartTime, setTrackerStopTime,removeAllTimeLog,setCaptures ,setActivityTick,removeExtraClicks} = timeLog.actions;
export default timeLog.reducer;