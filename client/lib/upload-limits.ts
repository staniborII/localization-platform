/**
 * Size ceiling for one upload.
 * Keep this equal to MAX_SINGLE_PUT_BYTES in infra/lib/upload/content-id.ts.
 */

/** Largest file the web client will hash and send. S3 accepts 5 GiB in one PUT. */
export const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;
