import { createStore } from 'vuex'

import projectData from './ProjectData'
import settings from './Settings'
import users from './Users'
import mainChat from './MainChats'
import brandSettingTab from './brandSettings'
import ToursData from './Tours';
import taskSelection from './TaskSelection';

const socketInstanceWatcher = (store) => {
    let previousSocketInstance = store.state.settings.socketInstance;
    store.subscribe((mutation, state) => {
      const newSocketInstance = state.settings.socketInstance;
      if (Object.keys(newSocketInstance).length && Object.keys(previousSocketInstance).length && newSocketInstance !== previousSocketInstance) {
        previousSocketInstance = newSocketInstance;
        if (Object.keys(state.projectData.getTaskSnapShotPayload).length) {
          store.dispatch('projectData/getTasksFromMongoDB', {...state.projectData.getTaskSnapShotPayload,from: 'storeWatch'});
        }
        if (state.projectData.taskDetailPayloadId.taskId) {
          store.dispatch('projectData/getTaskDetailSnapShot', {...state.projectData.taskDetailPayloadId,from: 'storeWatch'});
        }
        if (Object.keys(state.mainChat.chatPaylaod).length) {
          store.dispatch('mainChat/setChats', {...state.mainChat.chatPaylaod,from: 'storeWatch'});
        }
      } 
      else {
        previousSocketInstance = newSocketInstance
      }
    });
};

export default createStore({
    modules: {
        projectData,
        settings,
        users,
        mainChat,
        brandSettingTab,
        ToursData,
        taskSelection
    },
    plugins: [socketInstanceWatcher]
})
