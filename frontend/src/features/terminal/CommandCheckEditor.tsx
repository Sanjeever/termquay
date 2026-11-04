import type { CommandCheck } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';

export default function CommandCheckEditor({ check, onChange }: { check?: CommandCheck | null; onChange(check?: CommandCheck): void }) {
  return <div className="command-check-editor">
    <label className="form-field">结果判定<SelectControl value={check?.kind || ''} onChange={event => { const kind = event.target.value; onChange(kind ? { kind, expected: kind === 'exit' ? '0' : kind === 'json' ? 'true' : '', ...(kind === 'json' ? { operator: 'eq', pointer: '' } : {}), ...(kind === 'file' ? { file_path: '' } : {}) } : undefined); }}><option value="">按命令退出状态</option><option value="exit">指定退出码</option><option value="text">输出包含文本</option><option value="regex">输出匹配正则</option><option value="json">JSON 字段比较</option><option value="file">文件与基线一致</option></SelectControl></label>
    {check?.kind === 'file' ? <label className="form-field">远端文件路径<input required maxLength={4096} value={check.file_path || ''} onChange={event => onChange({ ...check, file_path: event.target.value })} /></label> : check && <>
      {check.kind !== 'exit' && <label className="form-field">输出通道<SelectControl value={check.source || 'stdout'} onChange={event => onChange({ ...check, source: event.target.value })}><option value="stdout">stdout</option><option value="stderr">stderr</option></SelectControl></label>}
      {check.kind === 'json' && <><label className="form-field">JSON Pointer<input maxLength={1024} placeholder="/services/0/healthy" value={check.pointer || ''} onChange={event => onChange({ ...check, pointer: event.target.value })} /></label><label className="form-field">比较方式<SelectControl value={check.operator || 'eq'} onChange={event => onChange({ ...check, operator: event.target.value })}><option value="eq">等于</option><option value="ne">不等于</option><option value="gt">大于</option><option value="gte">大于等于</option><option value="lt">小于</option><option value="lte">小于等于</option></SelectControl></label></>}
      <label className="form-field">{check.kind === 'exit' ? '预期退出码' : check.kind === 'json' ? '预期 JSON 值（字符串需引号）' : check.kind === 'regex' ? '正则表达式（Go 语法）' : '预期文本'}<input maxLength={4096} required type={check.kind === 'exit' ? 'number' : 'text'} min={check.kind === 'exit' ? 0 : undefined} max={check.kind === 'exit' ? 255 : undefined} value={check.expected || ''} onChange={event => onChange({ ...check, expected: event.target.value })} /></label>
    </>}
  </div>;
}
