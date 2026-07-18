import getConfig from 'next/config';

const { publicRuntimeConfig } = getConfig();
const { APIURL } = publicRuntimeConfig || {};

// The web app is a hash-router SPA served at APIURL (cf. Login: `${APIURL}/#/oauth2`).
// Task routes (frontend router/projects): with a folder →
//   /:cid/project/:id/fs/:folderId/:sprintId/:taskId
// without a folder →
//   /:cid/project/:id/s/:sprintId/:taskId
export function buildTaskWebUrl({ cid, projectId, folderObjId, sprintId, taskId }) {
  if (!cid || !projectId || !sprintId || !taskId) return '';
  const base = `/${cid}/project/${projectId}`;
  const path = folderObjId
    ? `${base}/fs/${folderObjId}/${sprintId}/${taskId}`
    : `${base}/s/${sprintId}/${taskId}`;
  return `${APIURL}/#${path}`;
}

// Open the task in the user's default browser via the main-process IPC.
export function openTaskInWeb(params) {
  const url = buildTaskWebUrl(params);
  if (url && window.ipc) window.ipc.send('open-external-url', url);
  return url;
}
