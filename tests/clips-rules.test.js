/**
 * Clips Rules Test Suite (COLLAB-04)
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Clips/clipsRules.js. Pure — no DB / socket / network.
 * Covers media-type / source normalisation (allow-lists), the persistability
 * predicate (a clip record needs a media url), and payload sanitisation.
 */

const {
    MEDIA_TYPES,
    SOURCES,
    normalizeMediaType,
    normalizeSource,
    canPersistClip,
    sanitizeClipPayload,
} = require('../Modules/Clips/clipsRules');

describe('🎬 CLIPS - Rules', () => {

    describe('normalizeMediaType', () => {
        test('accepts the known media types', () => {
            expect(normalizeMediaType('video')).toBe('video');
            expect(normalizeMediaType('audio')).toBe('audio');
        });
        test('trims surrounding whitespace', () => {
            expect(normalizeMediaType('  video  ')).toBe('video');
        });
        test('drops unknown / junk values', () => {
            expect(normalizeMediaType('gif')).toBe('');
            expect(normalizeMediaType(undefined)).toBe('');
            expect(normalizeMediaType(123)).toBe('');
        });
        test('the allow-list is exactly video/audio', () => {
            expect(MEDIA_TYPES).toEqual(['video', 'audio']);
        });
    });

    describe('normalizeSource', () => {
        test('accepts the known sources', () => {
            expect(normalizeSource('screen')).toBe('screen');
            expect(normalizeSource('voice')).toBe('voice');
            expect(normalizeSource('screenMic')).toBe('screenMic');
        });
        test('drops unknown / junk values', () => {
            expect(normalizeSource('webcam')).toBe('');
            expect(normalizeSource(null)).toBe('');
        });
        test('the allow-list is exactly screen/voice/screenMic', () => {
            expect(SOURCES).toEqual(['screen', 'voice', 'screenMic']);
        });
    });

    describe('canPersistClip', () => {
        test('a clip with a url can be persisted', () => {
            expect(canPersistClip({ url: 'https://files/clip.webm' })).toBe(true);
        });
        test('a clip without a url cannot be persisted', () => {
            expect(canPersistClip({ title: 'no file yet' })).toBe(false);
            expect(canPersistClip({ url: '   ' })).toBe(false);
        });
        test('a missing clip cannot be persisted', () => {
            expect(canPersistClip(undefined)).toBe(false);
            expect(canPersistClip(null)).toBe(false);
        });
    });

    describe('sanitizeClipPayload', () => {
        test('keeps only known fields', () => {
            const out = sanitizeClipPayload({
                title: 'Demo',
                url: 'https://files/clip.webm',
                userId: 'hack',
                deletedStatusKey: 9,
            });
            expect(out).toEqual({ title: 'Demo', url: 'https://files/clip.webm' });
        });
        test('omits fields that were not sent (partial update)', () => {
            expect(sanitizeClipPayload({ title: 'just a rename' })).toEqual({ title: 'just a rename' });
            expect(sanitizeClipPayload({})).toEqual({});
        });
        test('clamps mediaType and source to their allow-lists', () => {
            const out = sanitizeClipPayload({ mediaType: 'mp4', source: 'webcam' });
            expect(out).toEqual({ mediaType: '', source: '' });
            const ok = sanitizeClipPayload({ mediaType: 'video', source: 'screenMic' });
            expect(ok).toEqual({ mediaType: 'video', source: 'screenMic' });
        });
        test('coerces size and durationSec to numbers', () => {
            const out = sanitizeClipPayload({ size: '2048', durationSec: '12' });
            expect(out.size).toBe(2048);
            expect(out.durationSec).toBe(12);
            expect(sanitizeClipPayload({ size: 'NaN' }).size).toBe(0);
        });
        test('coerces title / url / mimeType to strings', () => {
            const out = sanitizeClipPayload({ title: 5, url: 7, mimeType: 9 });
            expect(out.title).toBe('5');
            expect(out.url).toBe('7');
            expect(out.mimeType).toBe('9');
        });
    });
});
