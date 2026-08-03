// AHE-3838 — shared helpers for cloud-linked attachments (Google Drive,
// Dropbox).
//
// An attachment is a plain object inside `task.attachments[]` /
// `project.attachments[]`. Uploaded files carry a Wasabi/server `url`. A cloud
// LINKED file carries no bytes of ours at all — instead:
//
//   source       'google_drive' | 'dropbox'
//   externalId   the provider's file id
//   externalUrl  where clicking it should go
//   externalIcon provider-supplied icon URL (optional)
//   thumbnailUrl provider-supplied preview image (optional)
//
// `source` being absent is the ONLY thing that marks an ordinary upload, so
// every read path can keep its existing behaviour untouched by branching on
// isCloudAttachment() first. A file IMPORTED from a provider is a normal upload
// and deliberately carries no `source`.

import googleDriveIcon from '@/assets/images/svg/google_drive.svg';
import dropboxIcon from '@/assets/images/svg/dropbox.svg';

export const CLOUD_PROVIDERS = {
    google_drive: { key: 'google_drive', label: 'Google Drive', short: 'Drive', icon: googleDriveIcon, color: '#1a73e8' },
    dropbox: { key: 'dropbox', label: 'Dropbox', short: 'Dropbox', icon: dropboxIcon, color: '#0061ff' },
};

/**
 * Is this attachment a link into someone's cloud drive (rather than a file we
 * store)? Unknown `source` values are treated as NOT cloud, so a record written
 * by a newer version of the app degrades to ordinary-attachment handling instead
 * of rendering a blank tile.
 */
export const isCloudAttachment = (attachment) =>
    !!(attachment && attachment.source && CLOUD_PROVIDERS[attachment.source]);

export const cloudProviderOf = (attachment) =>
    (isCloudAttachment(attachment) ? CLOUD_PROVIDERS[attachment.source] : null);

/**
 * Only http(s) may ever reach window.open or an href.
 *
 * A link-mode attachment is written through the ordinary task/project update API,
 * whose `attachments` array is free-form — so the record does NOT have to have
 * come from a picker. A crafted one carrying
 * `source: 'google_drive', externalUrl: 'javascript:…'` would otherwise be stored
 * XSS that fires when any viewer clicks the tile. Validating at the point of use
 * covers every route the record can arrive by, now or later.
 */
export const safeExternalUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? raw : '';
    } catch (e) {
        return ''; // not absolute, so not something we hand to the browser
    }
};

/**
 * Open a linked file in its provider. `noopener,noreferrer` matters here: the
 * target is a third-party origin, and without it the opened tab gets a
 * `window.opener` handle back into the app.
 */
export const openCloudAttachment = (attachment) => {
    if (!isCloudAttachment(attachment)) return false;
    const url = safeExternalUrl(attachment.externalUrl);
    if (!url) return false;
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
};

/**
 * Build the attachment record for a file picked from a provider. Shape matches
 * the uploaded-attachment record (filename/extension/size/id/createdAt/userId/
 * type) so every existing consumer keeps working; `url` is deliberately an
 * empty string rather than undefined, because several call sites do
 * `attachment.url.includes(...)` without a guard.
 */
export const buildCloudAttachment = ({ provider, file, userId, id }) => {
    const name = String((file && file.name) || 'file');
    const dot = name.lastIndexOf('.');
    return {
        filename: name,
        extension: dot > -1 ? name.slice(dot + 1) : '',
        size: Number((file && file.size) || 0),
        id,
        createdAt: new Date(),
        userId: String(userId || ''),
        type: cloudTypeOf(file && file.mimeType),
        url: '',

        source: provider,
        externalId: String((file && file.id) || ''),
        // Sanitised on the way in as well as on the way out.
        externalUrl: safeExternalUrl(file && file.url),
        externalIcon: String((file && file.iconUrl) || ''),
        thumbnailUrl: String((file && file.thumbnailUrl) || ''),
        externalOwner: String((file && file.owner) || ''),
    };
};

/**
 * Preview image for a linked file, or '' if we can't derive one.
 *
 * Why not the same mechanism uploads use: for an upload the app GENERATES its own
 * thumbnails at upload time (thumbnail.json sizes, the `attachmentIcon` key) and
 * serves them from our storage. A linked file has no bytes on our side, so there
 * is nothing to generate from — the preview has to come from the provider.
 *
 * For Drive we hit `drive.google.com/thumbnail?id=…`, which renders using the
 * VIEWER'S OWN Google session in the browser. No OAuth token, no Drive API, no
 * scope, no App ID — and it therefore also works for links attached before any of
 * that was configured. If the viewer has no access the image simply fails to load
 * and ImageIcon falls back to its placeholder, which is the same permission model
 * link mode already has.
 */
export const cloudPreviewUrlFor = (attachment) => {
    if (!isCloudAttachment(attachment)) return '';
    // Whatever the picker handed us wins — the Dropbox Chooser supplies one.
    if (attachment.thumbnailUrl) return String(attachment.thumbnailUrl);
    if (attachment.source === 'google_drive' && attachment.externalId) {
        return `https://drive.google.com/thumbnail?id=${encodeURIComponent(attachment.externalId)}&sz=w400`;
    }
    return '';
};

// Mirror of the `type` field on uploaded attachments, which is the leading
// segment of the MIME type ("image", "video", "application", …). Google Docs
// native files report vendor MIME types with no useful prefix, so they land on
// 'application', which is what the generic file tile expects.
export const cloudTypeOf = (mimeType) => {
    const mime = String(mimeType || '');
    const slash = mime.indexOf('/');
    if (slash < 1) return 'application';
    return mime.slice(0, slash);
};
