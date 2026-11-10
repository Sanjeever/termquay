import Modal from '../../components/Modal';
import { t as translate, currentLocale } from '../../i18n/index.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ModalBody, ModalContent, ModalHeader, ModalFooter } from '@heroui/react';
import { Browser } from '@wailsio/runtime';
import { commandByName, detailedCommandCount, posixCommands } from './posixCommands';
import ErrorNotice from '../../components/ErrorNotice';

export default function CommandHelpDialog({
  initial = '',
  enabled,
  onEnable,
  onClose,
}: {
  initial?: string;
  enabled: boolean;
  onEnable(): void;
  onClose(): void;
}) {
  useTranslation();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(initial || 'ls');
  const [error, setError] = useMessageState('');
  const navigation = useRef<HTMLElement>(null),
    article = useRef<HTMLElement>(null);
  const matches = useMemo(
    () =>
      posixCommands.filter((command) =>
        `${command.name} ${command.description}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, currentLocale()],
  );
  const command = commandByName.get(selected);
  useEffect(() => {
    if (article.current) article.current.scrollTop = 0;
    navigation.current?.querySelector('[aria-current=page]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <Modal
      isOpen
      onClose={onClose}
      className="app-dialog command-help-dialog"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>{translate('terminal:pOSIXCommandReference')}</ModalHeader>
        <ModalBody>
          {!enabled && (
            <div className="command-help-enable">
              <span className="muted">
                {translate('terminal:enhancedCompletionIsNotEnabledYet')}
              </span>
              <Button size="sm" variant="flat" onPress={onEnable}>
                {translate('terminal:enableCurrentShellIntegration')}
              </Button>
            </div>
          )}
          <input
            className="command-help-search"
            autoFocus
            aria-label={translate('terminal:searchPOSIXCommands')}
            placeholder={translate('terminal:searchCommandOrPurpose')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="command-help-layout">
            <nav ref={navigation} aria-label={translate('terminal:pOSIXCommands')}>
              {matches.map((item) => (
                <button
                  key={item.name}
                  aria-current={selected === item.name ? 'page' : undefined}
                  onClick={() => setSelected(item.name)}
                >
                  <code>{item.name}</code>
                  <span>{item.description}</span>
                </button>
              ))}
              {!matches.length && (
                <p className="muted" role="status">
                  {translate('terminal:noMatchingCommands')}
                </p>
              )}
            </nav>
            {command && (
              <article ref={article}>
                <h2>{command.name}</h2>
                <p>{command.description}</p>
                <pre>{command.synopsis}</pre>
                {!!command.operands.length && (
                  <dl className="command-help-arguments">
                    {command.operands.map((argument, index) => (
                      <div key={index}>
                        <dt>{argument.name}</dt>
                        <dd>
                          {argument.values
                            ?.map(([value, description]) => `${value} · ${description}`)
                            .join('；') ||
                            {
                              file: translate('terminal:filePath'),
                              directory: translate('terminal:directoryPath'),
                              value: translate('terminal:textArgument'),
                            }[argument.kind || 'value']}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {!!command.options.length && (
                  <table>
                    <caption>{translate('terminal:options')}</caption>
                    <tbody>
                      {command.options.map((option) => (
                        <tr key={option.name}>
                          <th>
                            <code>
                              {option.name}
                              {option.argument && ` ${option.argument.name}`}
                            </code>
                          </th>
                          <td>{option.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {!!command.examples.length && (
                  <>
                    <h3>{translate('terminal:examples')}</h3>
                    {command.examples.map((example) => (
                      <pre key={example}>{example}</pre>
                    ))}
                  </>
                )}
                {!command.options.length &&
                  !command.operands.length &&
                  !command.examples.length && (
                    <p className="muted">
                      {translate('terminal:thisCommandCurrentlyProvidesAPurposeIndexSee')}
                    </p>
                  )}
                <button
                  className="session-tool"
                  onClick={() =>
                    void Browser.OpenURL(
                      `https://manp.gs/posix/1/${encodeURIComponent(command.name === '.' ? 'dot' : command.name === ':' ? 'colon' : command.name)}`,
                    ).catch((error) => setError(error))
                  }
                >
                  {translate('terminal:openOriginalManual')}
                </button>
              </article>
            )}
          </div>
          <ErrorNotice message={error} onDismiss={() => setError('')} />
        </ModalBody>
        <ModalFooter>
          <span className="muted">
            {posixCommands.length} {translate('terminal:commands')}
            {detailedCommandCount} {translate('terminal:argumentDefinitions')}
          </span>
          <Button variant="light" onPress={onClose}>
            {translate('terminal:close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
