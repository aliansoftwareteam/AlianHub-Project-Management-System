// renderer/utils/apiQueue.js
const DB_NAME = 'offlineApiQueueDB';
const STORE_NAME = 'queue';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
        resolve(request.result)
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { autoIncrement: true });
      }
    };
  });
}

export async function addToQueue(request) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(request);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Entries WITH their keys. The replay needs to delete the row it just handled; deleting
// "the first one" instead (see removeFirstFromQueue) drops the wrong row as soon as any
// entry is skipped or fails.
export async function getQueueEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result || [];
      const vals = valsReq.result || [];
      resolve(keys.map((key, i) => ({ key, value: vals[i] })));
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeFromQueueByKey(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeFirstFromQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getAllKeysReq = store.getAllKeys();
    getAllKeysReq.onsuccess = () => {
      const keys = getAllKeysReq.result;
      if (keys.length > 0) {
        store.delete(keys[0]);
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    getAllKeysReq.onerror = () => reject(getAllKeysReq.error);
  });
}

export function formDataToObject(formData) {
  if (!(formData instanceof FormData)) return formData;
  const obj = {};
  for (const [key, value] of formData.entries()) {
    obj[key] = value;
  }
  return obj;
}

// Exported: Layout.jsx has always imported this by name, but it was never exported — so it
// arrived as undefined and every form-data replay threw "not a function". Combined with a
// catch that neither removed nor stopped on the failure, that is how an entry became
// permanently stuck and blocked logout.
export function objectToFormData(obj) {
  const formData = new FormData();
  for (const key in obj) {
    formData.append(key, obj[key]);
  }
  return formData;
}