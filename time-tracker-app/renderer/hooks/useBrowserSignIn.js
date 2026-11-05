import { useCallback, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { useRouter } from 'next/router';
import store from '../store/store';
import { checkWorkspace, connectWorkspace } from '../controller/workspace/workspace';
import { redeemSignInCode } from '../controller/user/signIn';

const drop = () => window.ipc.invoke('tracker:sign-in-drop');

/* A code is redeemed only on the workspace it was issued by. When it came back from a workspace
 * the window is not on, that workspace is checked and switched to first; the switch reloads the
 * window, and the code, still held by the main process, is redeemed on the next start. */
export function useBrowserSignIn(confirmStop) {
  const dispatch = useDispatch();
  const router = useRouter();
  const busy = useRef(false);

  return useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const arrived = await window.ipc.invoke('tracker:sign-in-peek');
      if (!arrived) return;
      const current = store.getState().workspace.current;
      if (arrived.workspace === current) {
        const payload = await window.ipc.invoke('tracker:sign-in-take', current);
        if (!payload) return;
        try {
          await redeemSignInCode(payload, dispatch);
          router.push('/home');
        } catch (error) {
          console.error('The workspace refused the sign-in code', error);
          router.push('/login');
        }
        return;
      }
      const result = await checkWorkspace(arrived.workspace);
      if (result.outcome !== 'ok') {
        await drop();
        router.push({ pathname: '/connect', query: { url: arrived.workspace, recheck: '1' } });
        return;
      }
      const outcome = await connectWorkspace(
        { url: arrived.workspace, ...result.workspace },
        { confirmStop: () => confirmStop(result.workspace.name), signIn: false },
      );
      if (!outcome.switched) await drop();
    } catch (error) {
      console.error('The browser sign-in could not be finished', error);
      await drop();
    } finally {
      busy.current = false;
    }
  }, [dispatch, router, confirmStop]);
}
