import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CLOUD_PROVIDERS,
    buildCloudAttachment,
    cloudPreviewUrlFor,
    cloudProviderOf,
    cloudTypeOf,
    isCloudAttachment,
    openCloudAttachment,
    safeExternalUrl,
} from '@/utils/cloudAttachment';

describe('cloudAttachment', () => {
    beforeEach(() => {
        vi.spyOn(window, 'open').mockImplementation(() => null);
    });

    describe('isCloudAttachment / cloudProviderOf', () => {
        it('recognises Drive and Dropbox links', () => {
            expect(isCloudAttachment({ source: 'google_drive' })).toBe(true);
            expect(isCloudAttachment({ source: 'dropbox' })).toBe(true);
            expect(cloudProviderOf({ source: 'google_drive' })).toBe(CLOUD_PROVIDERS.google_drive);
            expect(cloudProviderOf({ source: 'dropbox' }).label).toBe('Dropbox');
        });

        it('treats ordinary uploads, unknown sources and junk as not cloud', () => {
            expect(isCloudAttachment({ url: 'https://files/x.png' })).toBe(false);
            expect(isCloudAttachment({ source: 'onedrive' })).toBe(false);
            expect(isCloudAttachment({ source: '' })).toBe(false);
            expect(isCloudAttachment(null)).toBe(false);
            expect(isCloudAttachment(undefined)).toBe(false);
            expect(cloudProviderOf({ source: 'onedrive' })).toBeNull();
            expect(cloudProviderOf(undefined)).toBeNull();
        });

        // BUG: CLOUD_PROVIDERS[source] lookup matches Object.prototype keys (cloudAttachment.js:34)
        it.fails('does not mistake inherited object keys for providers', () => {
            expect(isCloudAttachment({ source: 'toString' })).toBe(false);
            expect(isCloudAttachment({ source: 'constructor' })).toBe(false);
        });
    });

    describe('safeExternalUrl', () => {
        it('keeps http and https links exactly as given', () => {
            expect(safeExternalUrl('https://drive.google.com/file/d/1/view')).toBe('https://drive.google.com/file/d/1/view');
            expect(safeExternalUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
        });

        it('trims surrounding whitespace', () => {
            expect(safeExternalUrl('  https://example.com/x \n')).toBe('https://example.com/x');
        });

        it.each([
            'javascript:alert(1)',
            'JaVaScRiPt:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'file:///etc/passwd',
            'ftp://example.com/file',
            'myapp://open',
            '/relative/path',
            'example.com/no-scheme',
            'not a url',
        ])('refuses %s', (value) => {
            expect(safeExternalUrl(value)).toBe('');
        });

        it('returns an empty string for empty, blank and missing values', () => {
            expect(safeExternalUrl('')).toBe('');
            expect(safeExternalUrl('   ')).toBe('');
            expect(safeExternalUrl(null)).toBe('');
            expect(safeExternalUrl(undefined)).toBe('');
            expect(safeExternalUrl(0)).toBe('');
        });
    });

    describe('openCloudAttachment', () => {
        it('opens a safe link in a new tab without giving it a handle back to the app', () => {
            const ok = openCloudAttachment({ source: 'dropbox', externalUrl: 'https://dropbox.com/s/1' });
            expect(ok).toBe(true);
            expect(window.open).toHaveBeenCalledWith('https://dropbox.com/s/1', '_blank', 'noopener,noreferrer');
        });

        it('refuses a crafted record with a javascript: link and opens nothing', () => {
            const ok = openCloudAttachment({ source: 'google_drive', externalUrl: 'javascript:alert(1)' });
            expect(ok).toBe(false);
            expect(window.open).not.toHaveBeenCalled();
        });

        it('refuses a cloud record with no link', () => {
            expect(openCloudAttachment({ source: 'google_drive' })).toBe(false);
            expect(window.open).not.toHaveBeenCalled();
        });

        it('refuses an ordinary upload even if it carries a valid external url', () => {
            expect(openCloudAttachment({ externalUrl: 'https://example.com' })).toBe(false);
            expect(openCloudAttachment({ source: 'onedrive', externalUrl: 'https://example.com' })).toBe(false);
            expect(openCloudAttachment(undefined)).toBe(false);
            expect(window.open).not.toHaveBeenCalled();
        });
    });

    describe('cloudTypeOf', () => {
        it('uses the leading segment of the mime type', () => {
            expect(cloudTypeOf('image/png')).toBe('image');
            expect(cloudTypeOf('video/mp4')).toBe('video');
            expect(cloudTypeOf('application/vnd.google-apps.document')).toBe('application');
        });

        it('falls back to application when there is no usable prefix', () => {
            expect(cloudTypeOf('')).toBe('application');
            expect(cloudTypeOf(undefined)).toBe('application');
            expect(cloudTypeOf(null)).toBe('application');
            expect(cloudTypeOf('pdf')).toBe('application');
            expect(cloudTypeOf('/png')).toBe('application');
        });
    });

    describe('buildCloudAttachment', () => {
        const file = {
            id: 'abc123',
            name: 'Quarterly report.final.pdf',
            size: '2048',
            mimeType: 'application/pdf',
            url: 'https://drive.google.com/file/d/abc123/view',
            iconUrl: 'https://icons/pdf.png',
            thumbnailUrl: 'https://thumbs/abc.png',
            owner: 'Ann',
        };

        it('builds a record shaped like an upload plus the cloud fields', () => {
            const before = Date.now();
            const att = buildCloudAttachment({ provider: 'google_drive', file, userId: 42, id: 'att-1' });
            expect(att).toMatchObject({
                filename: 'Quarterly report.final.pdf',
                extension: 'pdf',
                size: 2048,
                id: 'att-1',
                userId: '42',
                type: 'application',
                url: '',
                source: 'google_drive',
                externalId: 'abc123',
                externalUrl: 'https://drive.google.com/file/d/abc123/view',
                externalIcon: 'https://icons/pdf.png',
                thumbnailUrl: 'https://thumbs/abc.png',
                externalOwner: 'Ann',
            });
            expect(att.createdAt).toBeInstanceOf(Date);
            expect(att.createdAt.getTime()).toBeGreaterThanOrEqual(before);
        });

        it('yields a record that is recognised as cloud and can be opened', () => {
            const att = buildCloudAttachment({ provider: 'dropbox', file, userId: 'u', id: 'a' });
            expect(isCloudAttachment(att)).toBe(true);
            expect(openCloudAttachment(att)).toBe(true);
        });

        it('strips an unsafe picker url so the saved record can never open it', () => {
            const att = buildCloudAttachment({ provider: 'dropbox', file: { ...file, url: 'javascript:alert(1)' }, id: 'a' });
            expect(att.externalUrl).toBe('');
            expect(openCloudAttachment(att)).toBe(false);
        });

        it('derives the extension from the last dot only', () => {
            expect(buildCloudAttachment({ provider: 'dropbox', file: { name: 'a.tar.gz' }, id: 1 }).extension).toBe('gz');
        });

        it('leaves the extension empty when the name has no dot', () => {
            expect(buildCloudAttachment({ provider: 'dropbox', file: { name: 'README' }, id: 1 }).extension).toBe('');
        });

        it('keeps a trailing dot as an empty extension and a leading dot as the extension', () => {
            expect(buildCloudAttachment({ provider: 'dropbox', file: { name: 'weird.' }, id: 1 }).extension).toBe('');
            expect(buildCloudAttachment({ provider: 'dropbox', file: { name: '.env' }, id: 1 }).extension).toBe('env');
        });

        it('falls back to safe defaults for a missing or empty file', () => {
            const att = buildCloudAttachment({ provider: 'google_drive', id: 'x' });
            expect(att).toMatchObject({
                filename: 'file',
                extension: '',
                size: 0,
                userId: '',
                type: 'application',
                url: '',
                externalId: '',
                externalUrl: '',
                externalIcon: '',
                thumbnailUrl: '',
                externalOwner: '',
            });
            expect(buildCloudAttachment({ provider: 'google_drive', file: { name: '' }, id: 'x' }).filename).toBe('file');
        });

        // BUG: Number('big') is NaN and is not guarded (cloudAttachment.js:86)
        it.fails('turns a non-numeric size into 0 instead of NaN', () => {
            expect(buildCloudAttachment({ provider: 'dropbox', file: { size: 'big' }, id: 1 }).size).toBe(0);
        });

        it('takes the type from the mime prefix', () => {
            expect(buildCloudAttachment({ provider: 'dropbox', file: { mimeType: 'image/jpeg' }, id: 1 }).type).toBe('image');
        });
    });

    describe('cloudPreviewUrlFor', () => {
        it('prefers the thumbnail the picker supplied', () => {
            const att = { source: 'dropbox', thumbnailUrl: 'https://thumbs/x.png', externalId: 'id' };
            expect(cloudPreviewUrlFor(att)).toBe('https://thumbs/x.png');
            expect(cloudPreviewUrlFor({ ...att, source: 'google_drive' })).toBe('https://thumbs/x.png');
        });

        it('derives a Drive thumbnail link from the file id, encoding it', () => {
            expect(cloudPreviewUrlFor({ source: 'google_drive', externalId: 'a b/c&d' }))
                .toBe('https://drive.google.com/thumbnail?id=a%20b%2Fc%26d&sz=w400');
        });

        it('has no preview for Dropbox without a picker thumbnail', () => {
            expect(cloudPreviewUrlFor({ source: 'dropbox', externalId: 'id' })).toBe('');
        });

        it('has no preview for a Drive link missing its file id', () => {
            expect(cloudPreviewUrlFor({ source: 'google_drive', externalId: '' })).toBe('');
        });

        it('has no preview for uploads or missing attachments, even with a thumbnailUrl', () => {
            expect(cloudPreviewUrlFor({ thumbnailUrl: 'https://thumbs/x.png' })).toBe('');
            expect(cloudPreviewUrlFor(undefined)).toBe('');
        });
    });
});
