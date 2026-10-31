// Keep the picker, drag-and-drop detection and server allowlist in sync.
export const ARCHIVE_EXTENSIONS = Object.freeze([
  '.zip', '.7z', '.rar', '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tbz2', '.tbz',
  '.tar.xz', '.txz', '.tar.zst', '.tzst',
]);
export const ARCHIVE_ACCEPT = ARCHIVE_EXTENSIONS.join(',');
export const ARCHIVE_FORMAT_LABEL = 'ZIP、7Z、RAR、TAR、TAR.GZ、TAR.BZ2、TAR.XZ、TAR.ZST';
export function archiveExtension(name) {
  if (typeof name !== 'string') return null;
  const lower = name.toLowerCase();
  return ARCHIVE_EXTENSIONS.find(extension => lower.endsWith(extension)) || null;
}
export const isArchive = name => archiveExtension(name) !== null;
