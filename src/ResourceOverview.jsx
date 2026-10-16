import { FolderOpen, HardDrive, MemoryStick, Server, Info } from 'lucide-react';
import { formatBytes } from '../shared/usage';

const ratio = (available, total) => Number.isFinite(available) && total > 0 ? Math.max(0, Math.min(100, available / total * 100)) : null;

function ResourceMeter({ value, label, tone = '' }) {
  if (value == null) return null;
  return <div className={`resource-meter ${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(value.toFixed(1))}>
    <i style={{ width: `${value}%` }}/>
  </div>;
}

export default function ResourceOverview({ data }) {
  const { storage, server } = data;
  const unlimited = storage?.quota === null;
  const usedPercent = ratio(storage?.used, storage?.quota);
  const quotaTone = usedPercent >= 90 ? 'critical' : usedPercent >= 70 ? 'warning' : '';
  const resources = [
    { label: '服务器磁盘可用', icon: HardDrive, ...server?.disk, note: '项目、系统和其他服务共享此磁盘', disk: true },
    { label: '服务器内存可用', icon: MemoryStick, ...server?.memory, note: '包含系统可回收缓存的可用内存' }
  ];
  return <>
    <section className="workspace-storage" aria-label="个人存储">
      <div className="workspace-storage-main">
        <h3><FolderOpen size={17}/>我的工作区</h3>
        <strong>{formatBytes(storage?.used)}<small>已使用</small></strong>
        <p>项目、附件与 Codex 数据</p>
      </div>
      <div className="workspace-storage-quota">
        <div className="workspace-quota-heading"><span>配额剩余</span><strong>{unlimited ? '无限制' : formatBytes(storage?.available)}</strong></div>
        <ResourceMeter value={usedPercent} label="个人存储已使用比例" tone={quotaTone}/>
        {usedPercent != null && <p className="workspace-quota-percent">已使用 {Number(usedPercent.toFixed(1))}%</p>}
        <dl><div><dt>存储上限</dt><dd>{unlimited ? '无限制' : formatBytes(storage?.quota)}</dd></div><div><dt>单文件上限</dt><dd>{formatBytes(storage?.maxFile)}</dd></div></dl>
        {unlimited && <p className="workspace-quota-note">超级管理员无个人存储上限</p>}
      </div>
    </section>
    <section className="server-resources" aria-label="服务器资源">
      <header><h3><Server size={16}/>服务器资源</h3><span>与系统及其他用户共享</span></header>
      <div className="server-resource-grid">{resources.map(({ label, icon: Icon, available, total, note, disk }) => {
        const freePercent = ratio(available, total);
        const tone = disk && freePercent != null ? freePercent <= 10 ? 'critical' : freePercent <= 30 ? 'warning' : '' : '';
        return <article className="server-resource-card" key={label}>
          <h4><Icon size={16}/>{label}</h4>
          <strong>{formatBytes(available)}</strong>
          <div className="resource-amounts"><span>总量 {formatBytes(total)}</span><span>{freePercent == null ? '比例暂不可用' : `可用 ${Number(freePercent.toFixed(1))}%`}</span></div>
          <ResourceMeter value={freePercent} label={`${label}比例`} tone={tone}/>
          <p>{note}</p>
        </article>;
      })}</div>
      <p className="resource-note"><Info size={13}/><span>{server?.updatedAt && <>容量更新于 {new Date(server.updatedAt).toLocaleTimeString('zh-CN')} · </>}CLI / 终端写入不受网页配额约束</span></p>
    </section>
  </>;
}
