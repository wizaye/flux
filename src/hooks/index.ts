/**
 * Hooks barrel export — all operation handlers.
 * 
 * Import specific handlers based on your use case:
 * - useVaultOperations: vault lifecycle (open, close, create)
 * - useFileOperations: file CRUD (read, write, delete, move)
 * - useDirectoryOperations: directory operations
 * - useFileContent: content & dirty tracking
 */

export { useVaultOperations } from './use-vault-operations';
export { useFileOperations } from './use-file-operations';
export { useDirectoryOperations } from './use-directory-operations';
export { useFileContent } from './use-file-content';
