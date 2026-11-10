import { statusLabel } from '../../i18n/status';
import { eventError, errorMessage } from '../../lib/errors.ts';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { GetCommandRun } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type {
  CommandRunItem,
  CommandRunRecord,
  CommandRunSummary,
} from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import SelectControl from '../../components/SelectControl';

import ReadonlyDiffView from '../files/ReadonlyDiffView';

function key(item: CommandRunItem) {
  return JSON.stringify([item.target.address, item.target.identity || item.target.id, item.index]);
}
function value(item?: CommandRunItem) {
  return item
    ? JSON.stringify([
        item.state,
        item.error,
        item.result?.exit_code,
        item.result?.error,
        item.result?.truncated,
        item.result?.stdout,
        item.result?.stderr,
        item.check,
        item.baseline,
      ])
    : '';
}
export default function CommandRunComparison({
  current,
  runs,
}: {
  current: CommandRunRecord;
  runs: CommandRunSummary[];
}) {
  useTranslation();
  const [id, setID] = useState('');
  const [previous, setPrevious] = useState<CommandRunRecord>();
  const [error, setError] = useMessageState('');
  const [selected, setSelected] = useState('');
  const [channel, setChannel] = useState<'stdout' | 'stderr'>('stdout');
  useEffect(() => {
    setPrevious(undefined);
    setError('');
    setSelected('');
    if (!id) return;
    let ended = false;
    const request = GetCommandRun(id);
    request
      .then((record) => {
        if (!ended) setPrevious(record);
      })
      .catch((e) => {
        if (!ended) setError(e);
      });
    return () => {
      ended = true;
      request.cancel();
    };
  }, [id, current.summary.id]);
  const before = new Map((previous?.results || []).map((item) => [key(item), item]));
  const after = new Map((current.results || []).map((item) => [key(item), item]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const changes = keys.filter((key) => value(before.get(key)) !== value(after.get(key)));
  const oldItem = before.get(selected),
    newItem = after.get(selected);
  return (
    <section className="inspection-detail">
      <label className="form-field">
        {translate('terminal:compareWithAnotherRun')}
        <SelectControl value={id} onChange={(event) => setID(event.target.value)}>
          <option value="">{translate('terminal:selectAFinishedRecord')}</option>
          {runs
            .filter((run) => run.id !== current.summary.id && run.finished_at)
            .map((run) => (
              <option key={run.id} value={run.id}>
                {run.name} · {new Date(run.started_at).toLocaleString(currentLocale())}
              </option>
            ))}
        </SelectControl>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {id && !previous && !error && (
        <p role="status">{translate('terminal:readingComparisonRecord')}</p>
      )}
      {previous && (
        <>
          {JSON.stringify(previous.task.steps) !== JSON.stringify(current.task.steps) && (
            <p className="error" role="status">
              {translate('terminal:stepDefinitionsDifferBetweenRunsReviewCommandsAnd')}
            </p>
          )}
          <p role="status">
            {changes.length} / {keys.length} {translate('terminal:changedResults')}
          </p>
          <div className="inspection-table-scroll">
            <table className="inspection-table">
              <thead>
                <tr>
                  <th>{translate('terminal:hostStep')}</th>
                  <th>{translate('terminal:previous')}</th>
                  <th>{translate('terminal:current')}</th>
                  <th>{translate('terminal:change')}</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((itemKey) => {
                  const old = before.get(itemKey),
                    next = after.get(itemKey),
                    item = next || old!;
                  return (
                    <tr key={itemKey}>
                      <td>
                        <button
                          className="inspection-pick"
                          aria-pressed={selected === itemKey}
                          onClick={() => setSelected(itemKey)}
                        >
                          {item.target.name} · {item.step}
                        </button>
                        <small className="muted">{item.target.address}</small>
                      </td>
                      <td>
                        {old
                          ? `${statusLabel(old.state_code, old.state)}${old.result ? ` · ${old.result.exit_code}` : ''}`
                          : translate('terminal:noRecord')}
                      </td>
                      <td>
                        {next
                          ? `${statusLabel(next.state_code, next.state)}${next.result ? ` · ${next.result.exit_code}` : ''}`
                          : translate('terminal:noRecord')}
                      </td>
                      <td>
                        {!old
                          ? translate('terminal:newOrIdentityChanged')
                          : !next
                            ? translate('terminal:missingOrIdentityChanged')
                            : old.check?.actual !== next.check?.actual
                              ? translate('terminal:evaluatedValueChanged')
                              : translate('terminal:stateOrOutputChanged')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selected && (
            <>
              <div className="button-row">
                <SelectControl
                  aria-label={translate('terminal:crossRunComparisonChannel')}
                  value={channel}
                  onChange={(event) => setChannel(event.target.value as 'stdout' | 'stderr')}
                >
                  <option value="stdout">stdout</option>
                  <option value="stderr">stderr</option>
                </SelectControl>
                <span>
                  {oldItem?.check?.actual !== undefined &&
                    translate('terminal:previous2', { value1: oldItem.check.actual })}{' '}
                  {newItem?.check?.actual !== undefined &&
                    translate('terminal:current2', { value1: newItem.check.actual })}
                </span>
              </div>
              <ReadonlyDiffView
                left={
                  oldItem?.result?.[channel] ??
                  (oldItem
                    ? errorMessage(eventError(oldItem)) || oldItem.check?.message || ''
                    : undefined)
                }
                right={
                  newItem?.result?.[channel] ??
                  (newItem
                    ? errorMessage(eventError(newItem)) || newItem.check?.message || ''
                    : undefined)
                }
                leftLabel={translate('terminal:previousRun')}
                rightLabel={translate('terminal:currentRun')}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
