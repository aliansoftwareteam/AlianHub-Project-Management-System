import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useSelector } from 'react-redux';
import { HOSTED_DOMAIN, normaliseWorkspaceAddress, workspaceHost } from '../../utils/workspaceAddress';
import { APP_VERSION, checkWorkspace, connectWorkspace } from '../../controller/workspace/workspace';
import { useStopTimerPrompt } from '../Workspace/useStopTimerPrompt';

const ADDRESS_ERRORS = {
  empty: 'Enter your workspace address.',
  invalid: "That doesn't look like a workspace address.",
  insecure: 'Use an address that starts with https://. Only a workspace on this computer can use http://.',
};

const handshakeError = (outcome, url) => {
  const host = workspaceHost(url);
  if (outcome === 'unreachable') return `Couldn't reach ${host}. Check the address and your internet connection.`;
  return `No AlianHub workspace answered at ${host}. If it's self-hosted, it may need updating.`;
};

const Connect = () => {
  const router = useRouter();
  const { current } = useSelector((state) => state.workspace);
  const { isAuthenticated } = useSelector((state) => state.auth);
  const [address, setAddress] = useState('');
  const [view, setView] = useState({ phase: 'form' });
  const [update, setUpdate] = useState(null);
  const [askStop, stopPrompt] = useStopTimerPrompt();
  const linkedUrl = typeof router.query.url === 'string' ? router.query.url : '';
  const recheck = router.query.recheck === '1';
  const handledLink = useRef('');

  const connect = async (raw, { signIn }) => {
    const normalised = normaliseWorkspaceAddress(raw);
    if (!normalised.ok) {
      setView({ phase: 'form', error: ADDRESS_ERRORS[normalised.reason] });
      return;
    }
    const { url } = normalised;
    setView({ phase: 'checking', url });
    const result = await checkWorkspace(url);
    if (result.outcome === 'disabled' || result.outcome === 'tooOld') {
      setView({ phase: result.outcome, url, workspace: result.workspace, minVersion: result.minVersion });
      return;
    }
    if (result.outcome !== 'ok') {
      setAddress(raw);
      setView({ phase: 'form', error: handshakeError(result.outcome, url) });
      return;
    }
    try {
      const outcome = await connectWorkspace({ url, ...result.workspace }, { confirmStop: () => askStop(result.workspace.name), signIn });
      if (outcome.reason === 'same') router.push(isAuthenticated ? '/home' : '/login');
      else if (outcome.reason === 'unsynced') setView({ phase: 'form', error: 'Some tracked time has not reached your current workspace yet. Connect again once it has synced.' });
      else if (!outcome.switched) setView({ phase: 'form' });
    } catch (error) {
      console.error('Connecting the workspace failed', error);
      setView({ phase: 'form', error: 'The workspace could not be saved. Try again.' });
    }
  };

  useEffect(() => {
    if (!linkedUrl || handledLink.current === linkedUrl) return;
    handledLink.current = linkedUrl;
    setAddress(linkedUrl);
    connect(linkedUrl, { signIn: !recheck });
  }, [linkedUrl]);

  const submit = (event) => {
    event.preventDefault();
    connect(address, { signIn: true });
  };

  const tryAnother = () => {
    setUpdate(null);
    setAddress('');
    setView({ phase: 'form' });
    if (linkedUrl) router.replace('/connect');
  };

  const checkForUpdate = async () => {
    setUpdate({ state: 'checking' });
    try {
      const result = await window.ipc.invoke('updates:check');
      setUpdate(result && result.available ? { state: 'downloading', version: result.version } : { state: 'none' });
    } catch {
      setUpdate({ state: 'none' });
    }
  };

  const canGoBack = Boolean(current) && view.phase === 'form' && !recheck;
  const host = view.url ? workspaceHost(view.url) : '';
  const name = (view.workspace && view.workspace.name) || host;

  return (
    <div className="flex justify-center items-center min-h-[calc(100vh-45px)] bg-white relative overflow-hidden">
      <div className="absolute h-[151px] w-[151px] rounded-full border-[24px] border-[#EEF1FF] -top-[75px] -left-[65px] z-0"></div>
      <div className="absolute w-[403px] h-[403px] -right-[180px] -bottom-[180px] border-[50px] border-[#EEF1FF] rounded-full z-0"></div>

      <div className="max-w-[94%] w-full text-[#3A3A3A] p-5 rounded-xl bg-white shadow-[0px_2px_15px_rgba(0,0,0,0.12)] z-10">
        <div className="mb-4 text-center">
          <img src="/images/svg/alianhublogo.svg" alt="AlianHub Tracker" className="inline-block" />
        </div>

        {(view.phase === 'form' || view.phase === 'checking') && (
          <form onSubmit={submit} noValidate>
            <h3 className="font-bold text-xl text-center m-0">Connect to your workspace</h3>
            <label htmlFor="workspace-address" className="block text-xs font-medium mt-5 mb-1">Workspace address</label>
            <div className="flex items-center border border-[#D1D5DB] rounded focus-within:border-[#2F3990]">
              <input
                id="workspace-address"
                type="text"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={view.phase === 'checking'}
                placeholder="acme"
                aria-describedby="workspace-address-hint workspace-address-error"
                aria-invalid={Boolean(view.error)}
                className="flex-1 min-w-0 px-3 py-2 text-sm bg-transparent outline-none"
              />
              {!/[.:/]/.test(address) && <span className="pr-3 text-sm text-[#6B7280]">.{HOSTED_DOMAIN}</span>}
            </div>
            <p id="workspace-address-hint" className="text-xs text-[#6B7280] mt-1 mb-0">Self-hosted? Enter the full address.</p>
            <p id="workspace-address-error" role="alert" className="text-xs text-red-600 mt-2 mb-0 min-h-[16px]">{view.error || ''}</p>
            <button
              type="submit"
              disabled={view.phase === 'checking'}
              className="w-full mt-3 bg-[#2F3990] border border-[#2F3990] text-white py-2.5 text-sm rounded hover:bg-[#252d75] disabled:opacity-60 transition-colors cursor-pointer"
            >
              {view.phase === 'checking' ? `Checking ${host}…` : 'Continue'}
            </button>
            <p className="text-xs text-[#6B7280] text-center mt-4 mb-0">
              Or click "Open in tracker" in AlianHub → Settings → Time tracking.
            </p>
            {canGoBack && (
              <button type="button" onClick={() => router.push(isAuthenticated ? '/home' : '/login')} className="block mx-auto mt-3 text-xs text-[#2F3990] underline cursor-pointer">
                Back
              </button>
            )}
          </form>
        )}

        {view.phase === 'disabled' && (
          <div role="alert">
            <p className="text-sm font-medium m-0 truncate">{name} · {host}</p>
            <p className="text-sm mt-3 mb-0"><span aria-hidden="true" className="text-red-600 mr-1">✕</span>Time tracking isn't part of this workspace's plan.</p>
            <p className="text-sm text-[#6B7280] mt-2 mb-0">Ask your admin to add the time tracker in their AlianHub account.</p>
            <button type="button" onClick={tryAnother} className="w-full mt-5 bg-white border border-[#2F3990] text-[#2F3990] py-2.5 text-sm rounded hover:bg-[#EEF1FF] cursor-pointer">
              Try another address
            </button>
          </div>
        )}

        {view.phase === 'tooOld' && (
          <div role="alert">
            <p className="text-sm font-medium m-0 truncate">{name} · {host}</p>
            <p className="text-sm mt-3 mb-0">This workspace needs AlianHub Tracker {view.minVersion} or newer. You have {APP_VERSION}.</p>
            {update && update.state === 'downloading' && <p className="text-sm text-[#6B7280] mt-2 mb-0">Version {update.version} is downloading. It installs when you quit the tracker.</p>}
            {update && update.state === 'none' && <p className="text-sm text-[#6B7280] mt-2 mb-0">No update was found. Download the latest tracker from your workspace: Settings → Time tracking.</p>}
            <button type="button" onClick={checkForUpdate} disabled={update && update.state === 'checking'} className="w-full mt-5 bg-[#2F3990] border border-[#2F3990] text-white py-2.5 text-sm rounded hover:bg-[#252d75] disabled:opacity-60 cursor-pointer">
              {update && update.state === 'checking' ? 'Checking for updates…' : 'Check for updates'}
            </button>
            <button type="button" onClick={tryAnother} className="w-full mt-2 bg-white border border-[#2F3990] text-[#2F3990] py-2.5 text-sm rounded hover:bg-[#EEF1FF] cursor-pointer">
              Try another address
            </button>
          </div>
        )}
      </div>
      {stopPrompt}
    </div>
  );
};

export default Connect;
