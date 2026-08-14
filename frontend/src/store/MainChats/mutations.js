export function mutateChats(state, payload) {
    payload.forEach((pay) => {
        const {snap, op, data} = pay;
        if(snap) {
            state.chats.snap = snap;
        }
        if(op === "added") {
            state.chats.data.push(data);
        } else if(op === "modified") {
            const index = state.chats.data.findIndex((x) => x._id === data._id);
            if(index !== -1) {
                state.chats.data[index] = data;
            }
        } else if(op === "removed") {
            const index = state.chats.data.findIndex((x) => x._id === data._id);
            if(index !== -1) {
                state.chats.data.splice(index, 1);
            }
        }
    })
}

export function mutateChatProjects(state, payload) {
    payload.forEach((pay) => {
        const {snap, op, data} = pay;
        if(snap) {
            state.mainChatProjects.snap = snap;
        }
        if(op === "added") {
            const index = state.mainChatProjects.data.findIndex((rule) => rule._id === data._id);

            if(index !== -1) {
                state.mainChatProjects.data[index] = data;
            } else {
                state.mainChatProjects.data.push(data);
            }
        } else if(op === "modified") {
            const index = state.mainChatProjects.data.findIndex((rule) => rule._id === data._id);
            if(index !== -1) {
                state.mainChatProjects.data[index] = data;
            }
        } else if(op === "removed") {
            const index = state.mainChatProjects.data.findIndex((rule) => rule._id === data._id);
            if(index !== -1) {
                state.mainChatProjects.data.splice(index, 1);
            }
        }
    })
}

export const mutateChatSprints = (state,payload) => {
    const {op, data} = payload;
    let pId = data?.projectId;
    if(op === "added"){
        let projecIdFound = Object.keys(state.mainChatSprints).includes(pId);
        if(projecIdFound){
            const sprintIndex = state.mainChatSprints[pId].findIndex((x) => x._id === data._id);
            if(sprintIndex === -1){
                state.mainChatSprints[pId].push(data);
            }
        }else{
            // AHE-3834 — merge into the map; do NOT reassign it (that wiped every
            // other project's cached channels, so only 1 project was ever cached).
            state.mainChatSprints[pId] = [data];
        }
    }else if(op === "modified"){
        const sprintIndex = state.mainChatSprints[pId] && state.mainChatSprints[pId].length > 0 && state.mainChatSprints[pId]?.findIndex((x) => x._id === data._id);
        if(sprintIndex !== undefined && sprintIndex !== -1) {
            state.mainChatSprints[pId][sprintIndex] = {...data};
        }
    }else if(op === "removed"){
        if(state.mainChatSprints[pId]){
            const sprintIndex = state.mainChatSprints && state.mainChatSprints[pId] && state.mainChatSprints[pId].length > 0 && state.mainChatSprints[pId]?.findIndex((x) => x._id === data.id);
            if(sprintIndex !== -1) {
                state.mainChatSprints[pId].splice(sprintIndex, 1);
            }
        }
    }
}

export const mutateChatFolders = (state,payload) => {
    const {op, data} = payload;
    let pId = data?.projectId;
    if(op === "added"){
        let projecIdFound = Object.keys(state.mainChatFolders).includes(pId)
        if(projecIdFound){
            const sprintIndex = state.mainChatFolders[pId].findIndex((x) => x._id === data._id);
            if(sprintIndex === -1){
                state.mainChatFolders[pId].push(data);
            }
        }else{
            // AHE-3834 — merge into the map; do NOT reassign it (same cache-wipe bug).
            state.mainChatFolders[pId] = [data];
        }
    }else if(op === "modified"){
        const sprintIndex = state.mainChatFolders[pId] && state.mainChatFolders[pId].length > 0 && state.mainChatFolders[pId]?.findIndex((x) => x._id === data._id);
        if(sprintIndex !== undefined && sprintIndex !== -1) {
            state.mainChatFolders[pId][sprintIndex] = {...data};
        }
    }else if(op === "removed"){
        const sprintIndex = state.mainChatFolders[pId] && state.mainChatFolders[pId].length > 0 && state.mainChatFolders[pId]?.findIndex((x) => x._id === data._id);
        if(sprintIndex !== -1) {
            state.mainChatFolders[pId].splice(sprintIndex, 1);
        }
    }
}


export const setChatPayload = (state, payload) =>{
    state.chatPaylaod = payload;
}

export const setCommentRoomName = (state, payload) =>{
    state.commentRoomData = payload;
}