(() => {
    'use strict';

    const ORIGIN = window.location.origin;
    const GOOGLE_API = 'https://apis.google.com/js/api.js';
    const NONCE = /^[0-9a-f]{32}$/;
    const TYPE = {
        READY: 'drive-picker:ready',
        CONFIG: 'drive-picker:config',
        PICKED: 'drive-picker:picked',
        CANCEL: 'drive-picker:cancel',
        ERROR: 'drive-picker:error',
    };

    const opener = window.opener;
    let nonce = null;

    if (!opener || opener === window) {
        window.close();
        return;
    }

    const finish = (message) => {
        opener.postMessage(Object.assign({}, message, { nonce }), ORIGIN);
        window.close();
    };

    const text = (value) => (typeof value === 'string' ? value : '');

    const fileOf = (doc) => ({
        id: text(doc.id),
        name: text(doc.name),
        sizeBytes: Number(doc.sizeBytes) || 0,
        mimeType: text(doc.mimeType),
        url: text(doc.url),
        iconUrl: text(doc.iconUrl),
        thumbnails: (Array.isArray(doc.thumbnails) ? doc.thumbnails : [])
            .filter((thumbnail) => thumbnail && typeof thumbnail.url === 'string')
            .map((thumbnail) => ({ url: thumbnail.url, width: Number(thumbnail.width) || 0 })),
    });

    const loadGoogleApi = () => new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = GOOGLE_API;
        tag.async = true;
        tag.addEventListener('load', resolve);
        tag.addEventListener('error', reject);
        document.head.appendChild(tag);
    }).then(() => new Promise((resolve, reject) => {
        if (!window.gapi) throw new Error('gapi');
        window.gapi.load('picker', { callback: resolve, onerror: reject });
    }));

    const openPicker = (config) => {
        const picker = window.google.picker;
        const view = new picker.DocsView(picker.ViewId.DOCS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false);
        const builder = new picker.PickerBuilder()
            .setOAuthToken(config.token)
            .addView(view)
            .setCallback((data) => {
                if (data.action === picker.Action.CANCEL) finish({ type: TYPE.CANCEL });
                else if (data.action === picker.Action.PICKED) finish({ type: TYPE.PICKED, files: (data.docs || []).map(fileOf) });
            });
        // Google throttles keyless picker use.
        if (config.developerKey) builder.setDeveloperKey(config.developerKey);
        // Without the app id a drive.file pick grants the app nothing, and every later Drive call for the file 404s.
        if (config.appId) builder.setAppId(config.appId);
        if (config.multiple) builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
        builder.build().setVisible(true);
    };

    const validConfig = (data) => Boolean(data && typeof data === 'object' && data.type === TYPE.CONFIG
        && typeof data.nonce === 'string' && NONCE.test(data.nonce)
        && data.config && typeof data.config.token === 'string' && data.config.token);

    window.addEventListener('message', (event) => {
        if (nonce || event.origin !== ORIGIN || event.source !== opener || !validConfig(event.data)) return;
        nonce = event.data.nonce;
        const config = event.data.config;
        document.getElementById('status').textContent = text(config.labels && config.labels.loading);
        loadGoogleApi().then(() => openPicker(config)).catch(() => finish({ type: TYPE.ERROR }));
    });

    opener.postMessage({ type: TYPE.READY }, ORIGIN);
})();
