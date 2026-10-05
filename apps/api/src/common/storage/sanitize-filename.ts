/**
 * Closes the path-traversal gap identified in the post-launch gap audit:
 * a client-supplied `fileName` was previously interpolated directly into
 * an object-storage key (`evidence/${projectId}/${uuid}-${fileName}`,
 * `whistleblower/${reportId}/${uuid}-${fileName}`) with no sanitization.
 * A `fileName` containing `/` or `..` segments could shift where, within
 * the shared storage root, the encrypted blob actually gets written —
 * `FilesystemObjectStorageAdapter.resolvePath()` already stops it from
 * escaping the storage root entirely, but not from landing in a different
 * project's or report's own subtree within that root.
 *
 * Strips every path separator and collapses anything else to a safe,
 * storage-key-friendly character set. The ORIGINAL name is unaffected —
 * it's stored separately as the `fileName` database column and returned
 * to the client as-is; only the value used to build the storage key
 * itself is sanitized.
 */
export function sanitizeFilenameForStorageKey(fileName: string): string {
  const sanitized = fileName
    .replace(/[/\\]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized.length > 0 ? sanitized : 'file';
}
