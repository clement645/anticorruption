/**
 * DI token for the active BlockchainAdapter. Business/audit code injects
 * this token, never a concrete adapter class — swapping
 * `DevelopmentLedgerAdapter` for a future `PermissionedBlockchainAdapter` is
 * a one-line change to the provider in blockchain.module.ts.
 */
export const BLOCKCHAIN_ADAPTER = Symbol('BLOCKCHAIN_ADAPTER');
