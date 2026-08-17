import * as actions from './actions';
import * as mutations from './mutations';

const state = {
    users: [],
    myCounts: {},
}

const getters = {
    users: state => state.users,
    myCounts: state => state.myCounts,
    currentUser: (state) => {
        if(state.users) {
            return state.users?.find((x) => x._id === localStorage.getItem("userId"))
        } else {
            return {};
        }
    }
}

export default {
    namespaced: true,
    state : state,
    getters: getters,
    mutations: mutations,
    actions: actions
}