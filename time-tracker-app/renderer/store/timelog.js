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
    sprintName: ""
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
    // One activity "tick" = one second in which the OS reported recent input
    // (keyboard or mouse). Ticks are bucketed per minute into { time, active:N },
    // reusing the same 60-second window the old keystroke counter used. This
    // replaces the removed node-global-key-listener keyboard/mouse counters.
    setActivityTick: (state) => {
      if (!state.trackerStart) return;

      const now = new Date().getTime();
      const last = state.keyboardClicks.length > 0
        ? state.keyboardClicks[state.keyboardClicks.length - 1]
        : null;
      const withinSameMinute = last && Math.abs(now - new Date(last.time).getTime()) <= 60000;

      if (withinSameMinute) {
        state.keyboardClicks = state.keyboardClicks.map((itm, ind) =>
          ind === state.keyboardClicks.length - 1
            ? { ...itm, active: (itm.active || 0) + 1 }
            : { ...itm }
        );
      } else {
        state.keyboardClicks = [...state.keyboardClicks, { time: now, active: 1 }];
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
    }

  },
});

export const { setComment, setTrackerStartTime, setTrackerStopTime,removeAllTimeLog,setCaptures ,setActivityTick,removeExtraClicks} = timeLog.actions;
export default timeLog.reducer;