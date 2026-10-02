import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env } = vi.hoisted(() => ({ env: {} }));

vi.mock('@/config/env', () => env);

import { generateFileName, storageQueryBuilder } from '@/utils/storageQueryBuild';

const resetEnv = (storageType) => {
    Object.keys(env).forEach((k) => delete env[k]);
    Object.assign(env, {
        STORAGE_TYPE: storageType,
        UPLOAD_FILE: '/server/upload',
        UPLOAD_FILE_64: '/server/upload64',
        GET_SIGNED_OR_PUBLIC_URL: '/server/get',
        REMOVE_FILE: '/server/remove',
        DOMAIN_URI: 'https://hub.test',
        WASABI_UPLOAD_FILE: '/wasabi/upload',
        WASABI_UPLOAD64_FILE: '/wasabi/upload64',
        WASABI_RETRIVE_OBJECT: '/wasabi/get',
        WASABI_DELETE_FILE: '/wasabi/delete',
    });
};

describe('storageQueryBuilder', () => {
    describe('server storage', () => {
        beforeEach(() => resetEnv('server'));

        it('uploads to the server route', () => {
            expect(storageQueryBuilder('upload')).toEqual({ route: '/server/upload' });
            expect(storageQueryBuilder('upload_64')).toEqual({ route: '/server/upload64' });
        });

        it('builds a get url carrying bucket, file path and domain', () => {
            expect(storageQueryBuilder('get', 'bkt', 'a/b.png')).toEqual({
                route: '/server/get/bkt?filepath=a/b.png&domainUrl=https://hub.test',
                method: 'get',
            });
        });

        it('builds a delete as an http delete with an empty body', () => {
            expect(storageQueryBuilder('delete', 'bkt', 'a/b.png')).toEqual({
                route: '/server/remove/bkt?filepath=a/b.png',
                data: {},
                method: 'delete',
            });
        });
    });

    describe('wasabi storage', () => {
        beforeEach(() => resetEnv('wasabi'));

        it('uploads to the wasabi routes', () => {
            expect(storageQueryBuilder('upload')).toEqual({ route: '/wasabi/upload' });
            expect(storageQueryBuilder('upload_64')).toEqual({ route: '/wasabi/upload64' });
        });

        it('gets through the wasabi retrieve route without bucket or path in the url', () => {
            expect(storageQueryBuilder('get', 'bkt', 'a/b.png')).toEqual({ route: '/wasabi/get' });
        });

        it('deletes with a post whose body names the company and path', () => {
            expect(storageQueryBuilder('delete', 'bkt', 'a/b.png')).toEqual({
                route: '/wasabi/delete',
                data: { companyId: 'bkt', path: 'a/b.png' },
                method: 'post',
            });
        });
    });

    describe('unset or unrecognised storage type', () => {
        it.each([undefined, '', null, 'SERVER', 's3'])('uses wasabi routes when STORAGE_TYPE is %j', (type) => {
            resetEnv(type);
            expect(storageQueryBuilder('upload')).toEqual({ route: '/wasabi/upload' });
            expect(storageQueryBuilder('delete', 'b', 'p').method).toBe('post');
        });
    });

    describe('unknown request types', () => {
        beforeEach(() => resetEnv('server'));

        it.each(['download', '', undefined, null, 'UPLOAD'])('returns nothing for %j', (type) => {
            expect(storageQueryBuilder(type, 'b', 'p')).toBeUndefined();
        });
    });
});

describe('generateFileName', () => {
    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(1000);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });
    afterEach(() => vi.restoreAllMocks());

    it('prefixes a numeric stamp and swaps spaces for underscores', () => {
        expect(generateFileName('my holiday photo.png')).toBe('500_my_holiday_photo.png');
    });

    it('keeps other characters untouched when storage is not "server"', () => {
        expect(generateFileName('résumé (1)&.pdf', 'wasabi')).toBe('500_résumé_(1)&.pdf');
        expect(generateFileName('a#b.txt')).toBe('500_a#b.txt');
    });

    it('replaces unsafe characters with underscores for server storage', () => {
        expect(generateFileName('résumé (1)&.pdf', 'server')).toBe('500_r_sum___1__.pdf');
    });

    it('keeps letters, digits, dash, dot and slash for server storage', () => {
        expect(generateFileName('dir/My-File_2.v1.txt', 'server')).toBe('500_dir/My-File_2.v1.txt');
    });

    it('gives the same name different prefixes on different calls', () => {
        vi.restoreAllMocks();
        const names = new Set(Array.from({ length: 20 }, () => generateFileName('a.png')));
        expect(names.size).toBeGreaterThan(1);
        names.forEach((n) => expect(n).toMatch(/^\d+_a\.png$/));
    });

    it('throws for a missing file name', () => {
        expect(() => generateFileName(undefined)).toThrow();
    });
});
