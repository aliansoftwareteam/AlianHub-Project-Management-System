import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useSelector } from 'react-redux';
import { takeAutoSignIn } from '../../controller/workspace/workspace';
import { beginSignIn, openInBrowser, signInPageUrl } from '../../controller/user/signIn';
import { selectCurrentWorkspace } from '../../store/workspace';
import { workspaceHost } from '../../utils/workspaceAddress';

const Login = () => {
  const router = useRouter();
  const workspace = useSelector(selectCurrentWorkspace);

  async function openAlianhub() {
    if (!workspace) return;
    const started = await beginSignIn(workspace.url);
    openInBrowser(signInPageUrl(workspace.url, started));
  }

  useEffect(() => {
    if (workspace && takeAutoSignIn(workspace.url)) openAlianhub();
  }, [workspace && workspace.url]);

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
          {workspace && (
            <p className="font-normal text-xs leading-[19px] mt-2 mb-0 text-[#6B7280] truncate max-w-full" title={workspace.url}>
              {workspace.name ? `${workspace.name} · ` : ''}{workspaceHost(workspace.url)}
            </p>
          )}
        </div>
        <button
          type="submit"
          onClick={openAlianhub}
          className="w-full bg-[#2F3990] border border-[#2F3990] text-white py-2.5 text-sm leading-[23px] rounded hover:bg-[#252d75] transition-colors cursor-pointer"
        >
          Browser Login 
        </button>
        <button
          type="button"
          onClick={() => router.push('/connect')}
          className="block mx-auto mt-3 text-xs text-[#2F3990] underline bg-transparent border-0 cursor-pointer"
        >
          Use another workspace
        </button>
      </div>
    </div>
  );
};

export default Login; 