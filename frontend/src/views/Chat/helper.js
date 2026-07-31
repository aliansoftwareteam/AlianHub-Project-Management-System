import { inject } from "vue";
import { useStore } from "vuex";

export function useMainChat() {
    const companyId = inject("$companyId")
    const userId = inject("$userId")
    const {getters, dispatch} = useStore();

    function getProjects() {
        return new Promise((resolve, reject) => {
            try {
                if(getters["mainChat/mainChatProjects"]?.data?.length) {
                    resolve(true)
                } else {
                    dispatch("mainChat/setChatProjects")
                    .then(() => {
                        resolve(true)
                    })
                    .catch((error) => {
                        // The projects endpoint answers 404 when a company has no
                        // chat projects yet, so this path is reachable in normal
                        // use. Previously it neither resolved nor rejected, so the
                        // promise hung forever and every awaiting caller stalled.
                        console.error("ERROR in set project chat:", error);
                        reject(error);
                    })
                }
            } catch (error) {
                reject(error);
            }
        })
    }

    function dispatchChats(projectId = null, sprintId = null) {
        return new Promise((resolve, reject) => {
            try {
                if(!projectId) {
                    throw "NO project";
                }
                const cached = getters["mainChat/chats"]?.data?.length;
                // AHE-3834 — the socket room join + chatTask* listeners live inside
                // setChats. Previously a cached chat list short-circuited the dispatch
                // entirely, so leaving Chat (onUnmounted leaves the rooms) and coming
                // back left the conversation list with NO live updates until a reload.
                // Now we always dispatch; `from: 'storeWatch'` re-arms the socket
                // without re-fetching the cached list.
                dispatch("mainChat/setChats", {
                    projectId: projectId,
                    companyId: companyId.value,
                    userId: userId.value,
                    sprintId,
                    ...(cached ? { from: 'storeWatch' } : {})
                })
                .then((chats) => {
                    resolve(cached ? cached : chats);
                })
                .catch((error) => {
                    reject(error)
                })
            } catch (error) {
                reject(error);
            }
        })
    }

    return {
        getProjects,
        dispatchChats
    }
}