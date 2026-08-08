import { setUser } from "../../store/user";
import store from '../../store/store';
import { apiRequestWithoutCompnay } from "../../utils/services";
import { logout, setShowOfflineQueueScreen,setShowOflineLogout } from '../../store/authSlice'
import { replayQueue } from '../../utils/queueReplay';

export const getUserData = async () => {
    return new Promise((resolve, reject) => {
        try {
            let userId = localStorage.getItem("userId");
            apiRequestWithoutCompnay("get", `/api/v1/user/${userId}`).then((ele) => {
                let res = ele?.data || null;
                if (res) {
                    store.dispatch(setUser(res));
                }
                resolve(res);
            }).catch((error) => {
                console.error("IT is error of here",error);
                reject(error);
            });
        } catch (error) {
            reject(error);
        }
    });
};


export const logoutFunction = async () => {
    try {
        // Try to SEND what is queued before deciding anything. This used to only look at
        // the queue and refuse, while the only code that drained it ran on a timer that
        // starts exclusively when the app thinks it is offline — so once back online a
        // single stuck entry blocked logout forever, behind a message about the internet.
        const { remaining } = await replayQueue();

        if (remaining > 0) {
            store.dispatch(setShowOflineLogout(true));
            store.dispatch(setShowOfflineQueueScreen(true));
            // Optionally, show a toast or message here
            return;
        } else {
            try {
                const userId = localStorage.getItem("userId");
                const refreshToken = localStorage.getItem("refreshToken");
                await apiRequestWithoutCompnay("post", '/api/v2/logout', {
                    id: userId,
                    refreshToken: refreshToken,
                });                    
                store.dispatch(logout());
            } catch (error) {
                console.error('Error in logout', error);
                cleanup(data);
            }
        }
    } catch (error) {
        console.error(error);
    }
}

export const getUserImage = (body) => {
    return new Promise(async (resolve, rejected) => {
        try {
          var data = JSON.stringify(body)
          var url=`/api/v1/getUserProfile`
          apiRequestWithoutCompnay('post',url,data).then(response => {
            resolve(response.data)
  
          }).catch(error => {
            rejected({ status: false, message: error.message });
          })
        } catch (e) {
          rejected({ status: false, message: e.message });
        }
    });
}