import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { GetAISettings, SaveAISettings, TestAIConnection } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { AIConnectionTest, AISettingsUpdate } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';
import { errorMessage } from '../../lib/errors';

const examples: Record<string, string> = { chat_completions: 'https://api.openai.com/v1/chat/completions', messages: 'https://api.anthropic.com/v1/messages', responses: 'https://api.openai.com/v1/responses' };

export default function AISettings() {
  const [draft, setDraft] = useState<AISettingsUpdate>();
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState<AIConnectionTest>();
  useEffect(() => {
    let active = true;
    GetAISettings().then(value => { if (active) { setHasKey(value.has_api_key); setDraft({ ...value, api_key: '', api_key_action: 'keep' }); } }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);
  function update(value: Partial<AISettingsUpdate>) { setDraft(previous => previous && { ...previous, ...value }); setDirty(true); setTest(undefined); }
  async function save() {
    if (!draft || busy) return;
    setBusy('save'); setError('');
    try { const value = await SaveAISettings(draft); setHasKey(value.has_api_key); setDraft({ ...value, api_key: '', api_key_action: 'keep' }); setDirty(false); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  async function probe() {
    if (!draft || busy) return;
    setBusy('test'); setError(''); setTest(undefined);
    try { setTest(await TestAIConnection(draft)); } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  return <section className="settings-section ai-settings">
    <h2>AI 助手</h2>
    {draft && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={!!busy}>
        <label className="settings-row"><input type="checkbox" checked={draft.enabled} onChange={event => update({ enabled: event.target.checked })} />启用 AI 助手</label>
        <label>接口类型<SelectControl value={draft.protocol} onChange={event => update({ protocol: event.target.value })}><option value="chat_completions">Chat Completions</option><option value="messages">Messages</option><option value="responses">Responses</option></SelectControl></label>
        <label>请求 URL<input type="url" value={draft.endpoint} placeholder={examples[draft.protocol]} onChange={event => update({ endpoint: event.target.value })} maxLength={4096} spellCheck={false} /></label>
        <label>模型名称<input value={draft.model} onChange={event => update({ model: event.target.value })} maxLength={256} spellCheck={false} autoComplete="off" /></label>
        <div className="ai-key-row"><label>API Key<input type="password" value={draft.api_key} placeholder={hasKey && draft.api_key_action === 'keep' ? '已保存，留空保留' : '可留空'} onChange={event => update({ api_key: event.target.value, api_key_action: event.target.value ? 'replace' : 'keep' })} maxLength={8192} autoComplete="new-password" /></label>{hasKey && <Button size="sm" variant="light" onPress={() => update({ api_key: '', api_key_action: draft.api_key_action === 'clear' ? 'keep' : 'clear' })}>{draft.api_key_action === 'clear' ? '撤销清除' : '清除已存 Key'}</Button>}</div>
        <label className="settings-row"><input type="checkbox" checked={draft.confirm_exec} onChange={event => update({ confirm_exec: event.target.checked })} />执行 Shell 命令前确认</label>
        <p className="muted">发送的问题、主动加入的终端引用及工具读取的文件和输出会传到所配置的模型服务，其中可能包含敏感信息。</p>
        <div className="ai-settings-actions"><Button type="submit" size="sm" color="primary" isDisabled={!dirty} isLoading={busy === 'save'}>{dirty ? '保存' : '已保存'}</Button><Button size="sm" variant="bordered" isLoading={busy === 'test'} onPress={() => void probe()}>测试连接</Button></div>
      </fieldset>
    </form>}
    {test && <dl className="ai-test-results" aria-label="AI 连接测试结果"><div><dt>普通回复</dt><dd className={test.reply.ok ? '' : 'error'}>{test.reply.ok ? '可用' : test.reply.error}</dd></div><div><dt>工具调用与续接</dt><dd className={test.tools.ok ? '' : 'error'}>{test.tools.ok ? '可用' : test.tools.error}</dd></div></dl>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
