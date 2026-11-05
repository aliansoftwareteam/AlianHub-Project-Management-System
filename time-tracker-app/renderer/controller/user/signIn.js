import { login } from '../../store/authSlice';
import { getUserData } from './user';
import { getAssignCompanyData } from '../company/company';
import { apiRequestWithoutSecure } from '../../utils/services';
import { APP_VERSION } from '../workspace/workspace';

const RETURN_SCHEME = 'alianhub-tracker';

export const WORKSPACE_FINDER_URL = process.env.NEXT_PUBLIC_WORKSPACE_FINDER_URL || '';

export const signInPageUrl = (workspaceUrl, { challenge, state }) =>
  `${workspaceUrl}/#/oauth2?code_challenge=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}&scheme=${RETURN_SCHEME}`;

export const finderUrl = ({ challenge, state }) => {
  const params = new URLSearchParams({ code_challenge: challenge, state, scheme: RETURN_SCHEME, v: APP_VERSION });
  return `${WORKSPACE_FINDER_URL}?${params.toString()}`;
};

export const beginSignIn = (workspace = null) => window.ipc.invoke('tracker:begin-sign-in', { workspace });

export const openInBrowser = (url) => window.ipc.send('open-external-url', url);

/* Signs in to the workspace the window is on, with a code the main process matched to a sign-in
 * this tracker started. */
export const redeemSignInCode = async ({ code, userId, verifier }, dispatch) => {
  const res = await apiRequestWithoutSecure('post', '/api/v1/auth/loginAuthTracker', { code, userId, codeVerifier: verifier });
  const session = res && res.data;
  if (!session || !session.accessToken) throw new Error('The workspace did not accept the sign-in code');
  localStorage.setItem('refreshToken', session.refreshToken);
  localStorage.setItem('token', session.accessToken);
  localStorage.setItem('userId', session.uid);
  await getUserData(dispatch);
  dispatch(login());
  await getAssignCompanyData();
};
