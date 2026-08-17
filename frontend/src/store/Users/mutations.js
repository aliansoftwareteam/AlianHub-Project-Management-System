export const mutateUsers = (state, payload) => {
    const {data, op} = payload;
    if(op === "added") {
        const index = state.users.findIndex((type) => type._id === data._id);
        if(index === -1){
            state.users.push(data);
        }
    } else if(op === "modified") {
        const index = state.users.findIndex((type) => type._id === data._id);
        if(index !== -1) {
            state.users[index] = data;
        }
    } else if(op === "removed") {
        const index = state.users.findIndex((type) => type._id === data._id);
        if(index !== -1) {
            state.users.splice(index, 1);
        }
    }
}
export const mutateCounts = (state, payload) => {
    // AHE-3834 — the unread counts are delta-based and can transiently drift
    // negative on decrement races; never surface a negative badge. Clamp only the
    // count fields (composite keys ending in `_comments`), leaving other doc
    // fields untouched.
    const data = payload && payload.data;
    if (data && typeof data === 'object') {
        for (const key of Object.keys(data)) {
            if (key.endsWith('_comments') && typeof data[key] === 'number' && data[key] < 0) {
                data[key] = 0;
            }
        }
    }
    state.myCounts = payload;
}