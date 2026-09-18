/**
 * DI token for the active ObjectStorageAdapter. Business code injects this
 * token, never a concrete adapter class — mirrors BLOCKCHAIN_ADAPTER
 * (blockchain.constants.ts): swapping `FilesystemObjectStorageAdapter` for a
 * future S3-compatible adapter is a one-line change to the provider in
 * storage.module.ts.
 */
export const OBJECT_STORAGE_ADAPTER = Symbol('OBJECT_STORAGE_ADAPTER');
