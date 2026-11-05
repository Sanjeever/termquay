import type { CommandCheck } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';

export default function CommandCheckEditor({ check, onChange }: { check?: CommandCheck | null; onChange(check?: CommandCheck): void }) {
  return <div className="command-check-editor">
    <label className="form-field">通过条件<SelectControl value={check?.kind || 'exit'} onChange={event => { const kind = event.target.value; onChange({ kind, expected: kind === 'exit' ? '0' : kind === 'json' ? 'true' : '', ...(kind === 'json' ? { operator: 'eq', pointer: '' } : {}), ...(kind === 'file' ? { file_path: '' } : {}) }); }}><option value="exit">命令退出码符合预期</option><option value="text">输出包含文本</option><option value="regex">输出匹配正则</option><option value="json">JSON 字段符合预期</option><option value="file">文件与基线主机一致</option></SelectControl></label>
    {check?.kind === 'file' ? <label className="form-field">远端文件路径<input required maxLength={4096} value={check.file_path || ''} onChange={event => onChange({ ...check, file_path: event.target.value })} /></label> : check && <>
      {check.kind !== 'exit' && <label className="form-field">检查的输出<SelectControl value={check.source || 'stdout'} onChange={event => onChange({ ...check, source: event.target.value })}><option value="stdout">标准输出（stdout）</option><option value="stderr">错误输出（stderr）</option></SelectControl></label>}
      {check.kind === 'json' && <><label className="form-field">JSON 字段路径<input maxLength={1024} placeholder="/services/0/healthy" value={check.pointer || ''} onChange={event => onChange({ ...check, pointer: event.target.value })} /></label><label className="form-field">比较方式<SelectControl value={check.operator || 'eq'} onChange={event => onChange({ ...check, operator: event.target.value })}><option value="eq">等于</option><option value="ne">不等于</option><option value="gt">大于</option><option value="gte">大于等于</option><option value="lt">小于</option><option value="lte">小于等于</option></SelectControl></label></>}
      <label className="form-field">{check.kind === 'exit' ? '预期退出码' : check.kind === 'json' ? '预期 JSON 值（字符串需引号）' : check.kind === 'regex' ? '正则表达式（Go 语法）' : '预期文本'}<input maxLength={4096} required type={check.kind === 'exit' ? 'number' : 'text'} min={check.kind === 'exit' ? 0 : undefined} max={check.kind === 'exit' ? 255 : undefined} value={check.expected || ''} onChange={event => onChange({ ...check, expected: event.target.value })} /></label>
    </>}
  </div>;
}
