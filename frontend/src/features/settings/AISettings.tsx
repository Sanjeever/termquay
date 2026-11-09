import { t } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { GetAISettings, SaveAISettings, TestAIConnection } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { AIConnectionTest, AISettingsUpdate } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';


const examples: Record<string, string> = { chat_completions: 'https://api.openai.com/v1/chat/completions', messages: 'https://api.anthropic.com/v1/messages', responses: 'https://api.openai.com/v1/responses' };

export default function AISettings() {
  useTranslation();
  const [draft, setDraft] = useState<AISettingsUpdate>();
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useMessageState('');
  const [test, setTest] = useState<AIConnectionTest>();
  useEffect(() => {
    let active = true;
    GetAISettings().then(value => { if (active) { setHasKey(value.has_api_key); setDraft({ ...value, api_key: '', api_key_action: 'keep' }); } }).catch(e => { if (active) setError(e); });
    return () => { active = false; };
  }, []);
  function update(value: Partial<AISettingsUpdate>) { setDraft(previous => previous && { ...previous, ...value }); setDirty(true); setTest(undefined); }
  async function save() {
    if (!draft || busy) return;
    setBusy('save'); setError('');
    try { const value = await SaveAISettings(draft); setHasKey(value.has_api_key); setDraft({ ...value, api_key: '', api_key_action: 'keep' }); setDirty(false); }
    catch (e) { setError(e); } finally { setBusy(''); }
  }
  async function probe() {
    if (!draft || busy) return;
    setBusy('test'); setError(''); setTest(undefined);
    try { setTest(await TestAIConnection(draft)); } catch (e) { setError(e); } finally { setBusy(''); }
  }
  return <section className="settings-section ai-settings">
    <h2>{t('settings:aIAssistant')}</h2>
    {draft && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={!!busy}>
        <label className="settings-row"><input type="checkbox" checked={draft.enabled} onChange={event => update({ enabled: event.target.checked })} />{t('settings:enableAIAssistant')}</label>
        <label>{t('settings:aPIType')}<SelectControl value={draft.protocol} onChange={event => update({ protocol: event.target.value })}><option value="chat_completions">Chat Completions</option><option value="messages">Messages</option><option value="responses">Responses</option></SelectControl></label>
        <label>{t('settings:requestURL')}<input type="url" value={draft.endpoint} placeholder={examples[draft.protocol]} onChange={event => update({ endpoint: event.target.value })} maxLength={4096} spellCheck={false} /></label>
        <label>{t('settings:modelName')}<input value={draft.model} onChange={event => update({ model: event.target.value })} maxLength={256} spellCheck={false} autoComplete="off" /></label>
        <label>{t('settings:modelTimeoutMinutes')}<input type="number" min={1} max={30} step={1} required value={draft.request_timeout_minutes ?? ''} onChange={event => update({ request_timeout_minutes: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <div className="ai-key-row"><label>API Key<input type="password" value={draft.api_key} placeholder={hasKey && draft.api_key_action === 'keep' ? t('settings:savedLeaveBlankToKeep') : t('settings:optional')} onChange={event => update({ api_key: event.target.value, api_key_action: event.target.value ? 'replace' : 'keep' })} maxLength={8192} autoComplete="new-password" /></label>{hasKey && <Button size="sm" variant="light" onPress={() => update({ api_key: '', api_key_action: draft.api_key_action === 'clear' ? 'keep' : 'clear' })}>{draft.api_key_action === 'clear' ? t('settings:undoRemoval') : t('settings:removeSavedKey')}</Button>}</div>
        <label className="settings-row"><input type="checkbox" checked={draft.confirm_exec} onChange={event => update({ confirm_exec: event.target.checked })} />{t('settings:confirmBeforeExecutingShellCommands')}</label>
        <p className="muted">{t('settings:questionsExplicitlyAttachedTerminalReferencesAndFilesAnd')}</p>
        <div className="ai-settings-actions"><Button type="submit" size="sm" color="primary" isDisabled={!dirty} isLoading={busy === 'save'}>{dirty ? t('settings:save') : t('settings:saved')}</Button><Button size="sm" variant="bordered" isLoading={busy === 'test'} onPress={() => void probe()}>{t('settings:testConnection')}</Button></div>
      </fieldset>
    </form>}
    {test && <dl className="ai-test-results" aria-label={t('settings:aIConnectionTestResults')}><div><dt>{t('settings:textResponse')}</dt><dd className={test.reply.ok ? '' : 'error'}>{test.reply.ok ? t('settings:available') : test.reply.error}</dd></div><div><dt>{t('settings:toolCallsAndContinuation')}</dt><dd className={test.tools.ok ? '' : 'error'}>{test.tools.ok ? t('settings:available') : test.tools.error}</dd></div></dl>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
