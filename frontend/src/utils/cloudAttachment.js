// AHE-3838 — shared helpers for cloud-linked attachments (Google Drive,
// OneDrive, Dropbox).
//
// An attachment is a plain object inside `task.attachments[]` /
// `project.attachments[]`. Uploaded files carry a Wasabi/server `url`. A cloud
// LINKED file carries no bytes of ours at all — instead:
//
//   source       'google_drive' | 'onedrive' | 'dropbox'
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
import oneDriveIcon from '@/assets/images/svg/onedrive.svg';
import dropboxIcon from '@/assets/images/svg/dropbox.svg';

export const CLOUD_PROVIDERS = {
    google_drive: { key: 'google_drive', label: 'Google Drive', short: 'Drive', icon: googleDriveIcon, color: '#1a73e8' },
    onedrive: { key: 'onedrive', label: 'OneDrive', short: 'OneDrive', icon: oneDriveIcon, color: '#0364b8' },
    dropbox: { key: 'dropbox', label: 'Dropbox', short: 'Dropbox', icon: dropboxIcon, color: '#0061ff' },
};

export const CLOUD_PROVIDER_LIST = Object.values(CLOUD_PROVIDERS);

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
 * Open a linked file in its provider. `noopener,noreferrer` matters here: the
 * target is a third-party origin, and without it the opened tab gets a
 * `window.opener` handle back into the app.
 */
export const openCloudAttachment = (attachment) => {
    if (!isCloudAttachment(attachment) || !attachment.externalUrl) return false;
    window.open(attachment.externalUrl, '_blank', 'noopener,noreferrer');
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
        externalUrl: String((file && file.url) || ''),
        externalIcon: String((file && file.iconUrl) || ''),
        thumbnailUrl: String((file && file.thumbnailUrl) || ''),
        externalOwner: String((file && file.owner) || ''),
    };
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
