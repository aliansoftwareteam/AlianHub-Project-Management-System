import axios from 'axios';
import store from '../../store/store';
import { setWorkspaces } from '../../store/workspace';
import { setTrackerStopTime, removeAllTimeLog } from '../../store/timelog';
import { TrackerController } from '../tracker/tracker';
import { setWorkspaceBase } from '../../utils/workspaceBase';
import { normaliseWorkspaceAddress } from '../../utils/workspaceAddress';
import { runHandshake } from '../../utils/handshake';
import { switchWorkspace } from '../../utils/workspaceSwitch';
import { forgetSession } from '../../utils/workspaceSession';
import { replayQueue } from '../../utils/queueReplay';

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';
const AUTO_SIGN_IN_KEY = 'workspace:autoSignIn';

const apply = (state) => {
  const next = state || { workspaces: [], current: null };
  store.dispatch(setWorkspaces(next));
  setWorkspaceBase(next.current || '');
  return next;
};

export const loadWorkspaces = async () => {
  const baked = normaliseWorkspaceAddress(process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE || '', { allowHttp: true });
  return apply(await window.ipc.invoke('workspace:load', { buildDefault: baked.ok ? baked.url : '' }));
};

export const checkWorkspace = (url) => runHandshake(url, APP_VERSION, (address, options) => axios.get(address, options));

const stopRunningTimer = async () => {
  await TrackerController.TrackerStop();
  store.dispatch(setTrackerStopTime());
  store.dispatch(removeAllTimeLog());
};

/* Everything in memory belongs to the workspace being left, so a switch starts the window afresh. */
const moveTo = async (target, activate, confirmStop) => {
  const state = store.getState();
  const result = await switchWorkspace({
    target,
    current: state.workspace.current,
    isTracking: Boolean(state.timeLog.trackerStart),
    confirmStop,
    stopTimer: stopRunningTimer,
    drainQueue: replayQueue,
    storage: window.localStorage,
    activate: async () => apply(await activate()),
  });
  if (result.switched) window.location.reload();
  return result;
};

export const connectWorkspace = async (entry, { confirmStop, signIn = false }) => {
  if (signIn) window.sessionStorage.setItem(AUTO_SIGN_IN_KEY, entry.url);
  if (store.getState().workspace.current === entry.url) {
    apply(await window.ipc.invoke('workspace:add', entry));
    return { switched: false, reason: 'same' };
  }
  const result = await moveTo(entry.url, () => window.ipc.invoke('workspace:add', entry), confirmStop);
  if (!result.switched) window.sessionStorage.removeItem(AUTO_SIGN_IN_KEY);
  return result;
};

export const selectWorkspace = (url, { confirmStop }) => moveTo(url, () => window.ipc.invoke('workspace:select', url), confirmStop);

export const removeWorkspace = async (url) => {
  forgetSession(window.localStorage, url);
  return apply(await window.ipc.invoke('workspace:remove', url));
};

export const refreshWorkspace = async (url, { name, logoUrl }) => apply(await window.ipc.invoke('workspace:update', { url, name, logoUrl }));

/* A workspace connected from "Open in tracker" or the Connect screen goes straight on to the
 * browser sign-in once the window has started again on it. */
export const takeAutoSignIn = (url) => {
  const pending = window.sessionStorage.getItem(AUTO_SIGN_IN_KEY);
  if (!pending || pending !== url) return false;
  window.sessionStorage.removeItem(AUTO_SIGN_IN_KEY);
  return true;
};
