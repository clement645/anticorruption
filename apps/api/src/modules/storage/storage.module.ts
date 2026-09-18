import { Global, Module } from '@nestjs/common';
import { OBJECT_STORAGE_ADAPTER } from './storage.constants';
import { FilesystemObjectStorageAdapter } from './filesystem-storage.adapter';

/**
 * Global so the OBJECT_STORAGE_ADAPTER token is injectable from any module
 * (Phase 10's ProjectsModule today) without needing to import StorageModule
 * directly — mirrors BlockchainModule's own rationale exactly (see
 * blockchain.module.ts doc comment).
 */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE_ADAPTER,
      useClass: FilesystemObjectStorageAdapter,
    },
  ],
  exports: [OBJECT_STORAGE_ADAPTER],
})
export class StorageModule {}
