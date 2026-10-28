import { setUser } from "../../store/user";
import store from '../../store/store';
import { apiRequestWithoutCompnay, axiosInstanceWithoutCompany } from "../../utils/services";
import { logout, setShowOfflineQueueScreen,setShowOflineLogout } from '../../store/authSlice'
import { replayQueue } from '../../utils/queueReplay';
import signOut from '../../utils/signOut';

const { createSignOut } = signOut;

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


// Queued time is sent before deciding anything: the drain timer runs only while the app thinks
// it is offline, so without this one stuck entry blocked logout forever once back online.
// The server call bypasses the refresh-and-retry handling: a dead session refuses it too.
export const logoutFunction = createSignOut({
    replayQueue: () => replayQueue(),
    endServerSession: () => axiosInstanceWithoutCompany.post('/api/v2/logout', { id: localStorage.getItem("userId") }),
    endLocalSession: () => store.dispatch(logout()),
    holdForQueue: () => {
        store.dispatch(setShowOflineLogout(true));
        store.dispatch(setShowOfflineQueueScreen(true));
    },
});

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