import React, { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { login } from '../../store/authSlice';
import { useRouter } from 'next/router';
import { getUserData } from '../../controller/user/user';
import { getAssignCompanyData } from '../../controller/company/company';
const { publicRuntimeConfig } = getConfig();
import getConfig from "next/config";
import { apiRequestWithoutSecure} from '../../utils/services';
const { APIURL } = publicRuntimeConfig
const Login = () => {
  const dispatch = useDispatch();
  const router = useRouter();

  // The verifier for the sign-in this window started. It stays in memory, is spent on the first
  // deep link that follows, and is the only thing that makes an incoming `authorize` link ours.
  const pendingVerifier = useRef(null);

  const loginAPI = (code, userId, codeVerifier) => {
    return new Promise((resolve, reject) => {
      try {
        apiRequestWithoutSecure("post", `/api/v1/auth/loginAuthTracker`, {code, userId, codeVerifier}).then((ele) => {
          resolve(ele?.data)
        }).catch((error)=>{
          reject(error);
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  useEffect(() => {
    let isProcessing = false;
    
    const handleDeeplinkUrl = (url) => {
      if (isProcessing) return; // Prevent multiple executions
      // A link nobody here asked for is someone else's: without a pending sign-in there is no
      // verifier to present, and a page that pushes an `authorize` link at the tracker would
      // otherwise sign this computer in as whoever wrote the link.
      const codeVerifier = pendingVerifier.current;
      if (!codeVerifier) return;
      pendingVerifier.current = null;
      isProcessing = true;

      const params = new URLSearchParams(url.url.split("?").slice(1).join("?"))
      loginAPI(params.get("code"), params.get("client_id"), codeVerifier).then((ele)=>{
        localStorage.setItem('refreshToken', ele.refreshToken)
        localStorage.setItem('token', ele.accessToken)
        localStorage.setItem("userId", ele.uid);
        getUserData(dispatch).then(() => {
          dispatch(login());
          getAssignCompanyData().then(() => {
            router.push('/home');
          }).catch((error) => {
            console.error("Error getting Company Data", error);
            isProcessing = false; // Reset flag on error
          });
        }).catch((error) => {
          console.error(error);
          isProcessing = false; // Reset flag on error
        });
      }).catch((error) => {
        console.error(error);
        isProcessing = false; // Reset flag on error
      });
    };

    window.ipc.on('deeplinkUrl', handleDeeplinkUrl);
    
    // Cleanup function to remove the event listener
    return () => {
      window.ipc.removeAll('deeplinkUrl');
    };
  }, [dispatch, router]);

  async function openAlianhub() {
    const { verifier, challenge } = await window.ipc.invoke("tracker:pkce");
    pendingVerifier.current = verifier;
    window.ipc.send("open-external-url", `${APIURL}/#/oauth2?code_challenge=${encodeURIComponent(challenge)}`)
  }

  return (
    <div className="flex justify-center items-center h-[calc(100vh-45px)] bg-white relative overflow-hidden">

      {/* Background Circles */}
      <div className="absolute h-[151px] w-[151px] rounded-full border-[24px] border-[#EEF1FF] -top-[75px] -left-[65px] z-0"></div>
      <div className="absolute w-[403px] h-[403px] -right-[180px] -bottom-[180px] border-[50px] border-[#EEF1FF] rounded-full z-0"></div>

      {/* Login Container */}
      <div className="max-w-[94%] w-full text-[#959595] p-5 rounded-xl bg-white shadow-[0px_2px_15px_rgba(0,0,0,0.12)] z-10">
        {/* Logo */}
        <div className="mb-5 text-center">
          <img src="/images/svg/alianhublogo.svg" alt="Logo" />
        </div>

        {/* Login Text */}
        <div className="flex flex-col items-center text-center text-[#3A3A3A] mb-6">
          <h3 className="font-bold text-2xl m-0">Login to your Account</h3>
          <p className="font-normal text-xs leading-[19px] mt-2 mb-0">See what is going on with your business</p>
        </div>
        <button
          type="submit"
          onClick={openAlianhub}
          className="w-full bg-[#2F3990] border border-[#2F3990] text-white py-2.5 text-sm leading-[23px] rounded hover:bg-[#252d75] transition-colors cursor-pointer"
        >
          Browser Login 
        </button>
      </div>
    </div>
  );
};

export default Login; 