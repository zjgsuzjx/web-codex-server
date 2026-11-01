import type { UploadFile } from '../../../../shared/contracts/domain.ts';
import {
  USER_FILE_ENTRY_LIMIT,
  fileEntryLimitMessage,
} from '../../../../shared/files/file-limits.ts';
import { FOLDER_MAX_BYTES } from './zip-folder.ts';

// Capture entries synchronously: the browser protects DataTransfer after drop returns.
export function droppedFiles(
  dataTransfer: { items: any; files: any },
  signal: AbortSignal,
  onProgress: {
    (value: any): void;
    (arg0: {
      phase: string;
      name: any;
      index: number;
      count: number;
      done: number;
      total: number;
    }): void;
  },
  { maxEntries = USER_FILE_ENTRY_LIMIT }: { maxEntries?: number | null } = {},
) {
  const items = [...(dataTransfer.items || [])].filter((item) => item.kind === 'file');
  const roots = items.map((item) => ({
    entry: (item.getAsEntry || item.webkitGetAsEntry)?.call(item),
    file: item.getAsFile(),
  }));
  const fallback = [...dataTransfer.files];
  return (async () => {
    const files: any[] = [],
      directories: string[] = [];
    let bytes = 0,
      folder = false;
    const check = () => {
      if (signal?.aborted) throw new Error('已取消上传');
    };
    function add(file: UploadFile, name?: string) {
      check();
      bytes += file.size;
      if (folder && bytes > FOLDER_MAX_BYTES)
        throw new Error('浏览器压缩支持 128 MB 以内的文件夹；更大的文件夹请先压缩为 ZIP 后上传。');
      if (name) Object.defineProperty(file, 'uploadPath', { value: name, configurable: true });
      files.push(file);
      onProgress?.({
        phase: 'scanning',
        name: name || file.name,
        index: files.length,
        count: 0,
        done: 0,
        total: 0,
      });
      checkCount();
    }
    function checkCount() {
      if (maxEntries != null && files.length + directories.length > maxEntries)
        throw new Error(fileEntryLimitMessage(maxEntries));
    }
    async function visit(entry: FileSystemEntry, prefix = '') {
      check();
      const name = prefix + entry.name;
      if (entry.isFile) {
        add(
          await new Promise<UploadFile>((resolve, reject) =>
            (entry as FileSystemFileEntry).file(resolve, reject),
          ),
          name,
        );
        return;
      }
      if (!entry.isDirectory) throw new Error('拖入的项目无法读取，请使用上传菜单重试');
      directories.push(name);
      checkCount();
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        check();
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child, `${name}/`);
      }
    }
    folder = roots.some((root) => root.entry?.isDirectory);
    if (roots.length)
      for (const root of roots) {
        if (root.entry) await visit(root.entry);
        else if (root.file) add(root.file);
        else throw new Error('拖入的项目无法读取，请使用上传菜单重试');
      }
    else for (const file of fallback) add(file);
    return { files, directories, folder };
  })();
}
