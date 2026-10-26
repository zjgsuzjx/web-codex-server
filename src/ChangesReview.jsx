import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, FileDiff, File, RefreshCw } from 'lucide-react';
import { hunkRows } from '../shared/file-changes.js';
import { ChangeStats } from './ChangeSummary';
import LoadingPlaceholder from './LoadingPlaceholder';
import Select from './Select';

const kindLabel = { add: '新增', delete: '删除', update: '修改', rename: '重命名' };
function DiffFile({ file, onFile }) {
  return <details className="review-diff-file" open><summary><FileDiff size={14}/><span title={file.path}>{file.path}</span><small>{kindLabel[file.kind] || '修改'}</small><ChangeStats {...file}/><ChevronDown size={13}/></summary>
    {file.kind !== 'delete' && <div className="review-file-actions"><button type="button" onClick={() => onFile(file.path)}><File size={12}/>打开当前文件</button></div>}
    {file.previousPath && <p className="review-previous-path">原路径：{file.previousPath}</p>}
    {file.previewWarning && <p className="review-scope-note">{file.previewWarning}</p>}
    {file.patches?.some(patch => patch.hunks?.length) ? <div className="review-diff-code" tabIndex={0} aria-label={`${file.path} 的代码差异`}>{file.patches.map((patch, index) => <div key={index}>{file.patches.length > 1 && <div className="diff-hunk-header">第 {index + 1} 次修改</div>}{patch.hunks.map((hunk, h) => <div key={h}><div className="diff-hunk-header">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</div>{hunkRows(hunk).map((row, line) => <div className={`diff-line diff-${row.type}`} key={line}><span className="diff-line-number">{row.oldLine}</span><span className="diff-line-number">{row.newLine}</span><span className="diff-line-sign">{row.type === 'add' ? '+' : row.type === 'delete' ? '−' : ''}</span><code>{row.text || ' '}</code></div>)}</div>)}</div>)}</div> : <p className="review-diff-unavailable">{file.reason || (file.kind === 'rename' ? '文件路径已更改，内容没有文本行变更。' : '文件没有文本行变更。')}</p>}
  </details>;
}

export default function ChangesReview({ review, summary, api, onSelect, onFile }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0), [limit, setLimit] = useState(20);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    const url = `/threads/${encodeURIComponent(review.threadId)}/turns/${encodeURIComponent(review.turnId)}/changes${review.path ? `?path=${encodeURIComponent(review.path)}` : ''}`;
    api(url, { signal: abort.signal }).then(result => { if (!abort.signal.aborted) setData(result); }).catch(err => { if (!abort.signal.aborted) setError(err.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [review.threadId, review.turnId, review.path, summary?.revision, retry, api]);
  const files = data?.files || [], choices = summary?.files || files;
  return <div className="changes-review"><div className="changes-review-toolbar"><div><FileDiff size={14}/><strong>本轮变更</strong><span>{files.length} 个文件</span></div><Select aria-label="筛选变更文件" value={review.path || ''} onChange={event => onSelect(event.target.value || undefined)}><option value="">全部文件</option>{choices.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}</Select>{review.path && <button type="button" className="review-show-all" onClick={() => onSelect()}><ArrowLeft size={12}/>全部</button>}</div>
    <div className="changes-review-scroll">{error ? <div className="review-load-error" role="alert">{error}<button type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={13}/>重新加载</button></div> : !data ? <LoadingPlaceholder label="正在读取修改详情…" variant="code" rows={8}/> : <>{data.warning && <p className="review-scope-note">{data.warning}</p>}<div className="review-diff-legend"><span>本轮开始前</span><span>本轮修改后</span><ChangeStats {...data}/>{loading && <span>正在更新…</span>}</div>{files.length ? files.slice(0, limit).map(file => <DiffFile key={file.path} file={file} onFile={onFile}/>) : <p className="review-scope-note">{review.path ? '这个文件已没有本轮净变更。' : '本轮没有项目文件变更。'}</p>}{files.length > limit && <button className="change-expand" type="button" onClick={() => setLimit(value => value + 20)}>再显示 {Math.min(20, files.length - limit)} 个文件<ChevronDown size={13}/></button>}</>}</div>
  </div>;
}
