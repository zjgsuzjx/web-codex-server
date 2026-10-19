import { Archive, Copy, FileCheck2, LoaderCircle, Upload, X } from 'lucide-react';
import { formatBytes } from '../shared/usage';
import Modal from './Modal';
import IconButton from './IconButton';

const labels = {scanning:'正在读取文件夹',compressing:'正在压缩文件夹',uploading:'正在上传',extracting:'正在解压并检查文件',finishing:'正在保存文件',conflict:'等待处理重名文件',complete:'上传完成'};
export function UploadProgress({ progress, onCancel, inline = false }) {
  const stage = progress.phase || 'uploading';
  const extracting = stage === 'extracting', waiting = stage === 'conflict' || stage === 'scanning';
  const total = extracting ? progress.stageTotal : progress.total, done = extracting ? progress.stageDone : progress.done;
  const percent = waiting || extracting && !total ? null : Math.round(Math.max(0,Math.min(100,progress.percent ?? (total ? done / total * 100 : stage === 'complete' || stage === 'finishing' ? 100 : 0))));
  const Icon = stage === 'compressing' || extracting ? Archive : Upload;
  return <section className={`upload-progress ${inline ? 'editor-upload-progress' : ''}`} aria-label="上传进度">
    <div className="upload-progress-heading"><span className="upload-progress-icon"><Icon size={18}/></span><strong role="status">{labels[stage] || stage}</strong><span className="upload-percent">{percent == null ? <LoaderCircle size={17} className="spin" aria-label="处理中"/> : `${percent}%`}</span><IconButton title="取消上传" onClick={onCancel}><X size={15}/></IconButton></div>
    <div className="upload-progress-track" role="progressbar" aria-label={labels[stage] || stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent == null ? '正在处理' : `${percent}%`}><i className={percent == null ? 'indeterminate' : ''} style={{width:percent == null ? '35%' : `${percent}%`}}/></div>
    <div className="upload-progress-details"><span title={progress.name}>{progress.name || '准备文件'}</span><span>{extracting ? total ? `${done} / ${total} 项` : '正在校验' : stage === 'scanning' ? `已找到 ${progress.index || 0} 个文件` : `${formatBytes(progress.done || 0)} / ${formatBytes(progress.total || 0)}`}</span></div>
    {progress.compression && <p className="upload-compression">压缩后 {formatBytes(progress.compression.compressed)}<span>原始 {formatBytes(progress.compression.original)} · {progress.compression.compressed < progress.compression.original ? `节省 ${Math.min(99.9,(1-progress.compression.compressed/progress.compression.original)*100).toFixed(1)}%` : '已完成 ZIP 打包'}</span></p>}
  </section>;
}

export function UploadConflict({ conflict, onResolve }) {
  const paths = conflict.conflicts || [], count = conflict.conflictCount || paths.length;
  return <Modal title="发现重名文件" subtitle={`有 ${count} 项与项目中的现有路径重复。请选择本次上传的处理方式。`} icon={Copy} className="upload-conflict" onClose={() => onResolve('cancel')}>
    <div className="modal-form">
    <ul className="upload-conflict-paths">{paths.slice(0,8).map(item => <li key={item.path}><Copy size={13}/><span>{item.path}</span>{!item.overwrite && <small>类型冲突</small>}</li>)}{count > 8 && <li className="muted">另有 {count-8} 项…</li>}</ul>
    <p className="upload-conflict-hint">文件夹会合并。文件与文件夹类型冲突的项目会跳过。此选择适用于本次上传的所有重名文件。</p>
    <div className="upload-conflict-choices"><button type="button" onClick={() => onResolve('skip')}><FileCheck2 size={19}/><span><strong>跳过重名文件</strong><small>保留现有文件，继续上传其余文件</small></span></button><button type="button" onClick={() => onResolve('overwrite')}><Copy size={19}/><span><strong>覆盖重名文件</strong><small>使用本次上传的文件替换同路径文件</small></span></button></div>
    <div className="action-footer"><button type="button" className="secondary" onClick={() => onResolve('cancel')}>取消本次上传</button></div>
    </div>
  </Modal>;
}
