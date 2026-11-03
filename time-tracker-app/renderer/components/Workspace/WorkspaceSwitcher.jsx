import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useSelector } from 'react-redux';
import { selectCurrentWorkspace } from '../../store/workspace';
import { workspaceHost } from '../../utils/workspaceAddress';
import { removeWorkspace, selectWorkspace } from '../../controller/workspace/workspace';
import { useStopTimerPrompt } from './useStopTimerPrompt';

const DESKTOP_LOGO_PATH = '/api/v1/getLogo?key=logo&type=desktop';
const logoOf = (workspace) => `${workspace.url}${workspace.logoUrl || DESKTOP_LOGO_PATH}`;
const nameOf = (workspace) => workspace.name || workspaceHost(workspace.url);

const WorkspaceSwitcher = () => {
  const router = useRouter();
  const workspaces = useSelector((state) => state.workspace.workspaces);
  const current = useSelector(selectCurrentWorkspace);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askStop, stopPrompt] = useStopTimerPrompt();
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (panel.current && !panel.current.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!current) {
    return <span className="ml-[5px] text-white">AlianHub Tracker</span>;
  }

  const switchTo = async (workspace) => {
    if (busy || workspace.url === current.url) return;
    setBusy(true);
    setError('');
    try {
      const result = await selectWorkspace(workspace.url, { confirmStop: () => askStop(nameOf(workspace)) });
      if (result.reason === 'unsynced') setError(`Some tracked time has not reached ${nameOf(current)} yet. Switch again once it has synced.`);
    } catch (e) {
      console.error('Switching workspace failed', e);
      setError('The workspace could not be switched. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const forget = async (workspace) => {
    setError('');
    try {
      await removeWorkspace(workspace.url);
    } catch (e) {
      console.error('Removing workspace failed', e);
    }
  };

  return (
    <div className="relative no-drag" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${nameOf(current)} · ${workspaceHost(current.url)}`}
        className="flex items-center max-w-[200px] bg-transparent border-0 p-0 cursor-pointer text-white text-sm"
      >
        <img src={logoOf(current)} className="h-[26px] w-[26px] shrink-0" alt="" />
        <span className="ml-[5px] truncate">{nameOf(current)}</span>
        <svg className="w-3 h-3 ml-1 shrink-0 opacity-80" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-[34px] w-[280px] bg-white rounded-lg shadow-[0px_2px_15px_rgba(0,0,0,0.2)] z-50 py-1 text-[#374151]">
          <ul role="listbox" aria-label="Workspaces" className="m-0 p-0 list-none max-h-[260px] overflow-y-auto">
            {workspaces.map((workspace) => {
              const isCurrent = workspace.url === current.url;
              return (
                <li key={workspace.url} role="option" aria-selected={isCurrent} className="flex items-center hover:bg-gray-100">
                  <button type="button" disabled={busy} onClick={() => switchTo(workspace)} className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left bg-transparent border-0 cursor-pointer disabled:opacity-60">
                    <img src={logoOf(workspace)} className="h-[22px] w-[22px] shrink-0" alt="" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{nameOf(workspace)}</span>
                      <span className="block text-[11px] text-[#6B7280] truncate">{workspaceHost(workspace.url)}</span>
                    </span>
                    {isCurrent && <span className="ml-auto text-[#2F3990] text-sm" aria-label="Current workspace">✓</span>}
                  </button>
                  {!isCurrent && (
                    <button type="button" onClick={() => forget(workspace)} aria-label={`Remove ${nameOf(workspace)}`} title="Remove" className="px-3 py-2 text-[#9CA3AF] hover:text-red-600 bg-transparent border-0 cursor-pointer">
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {error && <p role="alert" className="text-xs text-red-600 px-3 py-1 m-0">{error}</p>}
          <button
            type="button"
            onClick={() => { setOpen(false); router.push('/connect'); }}
            className="w-full text-left px-3 py-2 text-sm text-[#2F3990] border-0 border-t border-solid border-[#E5E7EB] bg-transparent hover:bg-gray-100 cursor-pointer"
          >
            + Add a workspace
          </button>
        </div>
      )}
      {stopPrompt}
    </div>
  );
};

export default WorkspaceSwitcher;
