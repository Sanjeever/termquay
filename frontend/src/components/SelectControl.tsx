import { t as translate } from '../i18n/index.ts';
import { useTranslation } from 'react-i18next';
import {
  Children,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type SelectHTMLAttributes,
} from 'react';
import { Select, SelectItem } from '@heroui/react';
import Tooltip from './Tooltip';

export default function SelectControl({
  children,
  value,
  defaultValue,
  onChange,
  className,
  id,
  title,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'>) {
  const { i18n } = useTranslation();
  const options = Children.toArray(children).filter(isValidElement) as ReactElement<{
    value?: string;
    children: string;
    disabled?: boolean;
  }>[];
  const [selected, setSelected] = useState(String(defaultValue ?? options[0]?.props.value ?? ''));
  const native = useRef<HTMLSelectElement>(null);
  const [portal, setPortal] = useState<HTMLElement>();
  const [label, setLabel] = useState(props['aria-label'] || title || translate('common:select'));
  const [invalid, setInvalid] = useState(false);
  useLayoutEffect(() => {
    setPortal(native.current?.closest<HTMLElement>('[role=dialog], details') || document.body);
    if (props['aria-label'] || title) {
      setLabel(props['aria-label'] || title!);
      return;
    }
    const parent = native.current?.closest('label');
    const text = parent
      ? Array.from(parent.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join('')
          .trim()
      : id
        ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
        : '';
    setLabel(text || translate('common:select'));
  }, [id, props['aria-label'], title, i18n.resolvedLanguage]);
  const current = String(value ?? selected);
  return (
    <>
      <select
        {...props}
        ref={native}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        value={current}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          const details = native.current?.closest('details');
          if (details) details.open = true;
          requestAnimationFrame(() =>
            native.current?.nextElementSibling?.querySelector<HTMLButtonElement>('button')?.focus(),
          );
        }}
        onChange={(event) => {
          setInvalid(false);
          setSelected(event.target.value);
          onChange?.(event);
        }}
      >
        {children}
      </select>
      <Tooltip content={title} isDisabled={props.disabled}>
        <Select
          id={id}
          aria-label={label}
          aria-required={props.required}
          isInvalid={invalid}
          errorMessage={translate('common:select2', { value1: label })}
          validationBehavior="aria"
          disableAnimation
          popoverProps={{ portalContainer: portal }}
          scrollShadowProps={{ hideScrollBar: false }}
          className={`select-control ${className || ''}`}
          classNames={{
            trigger: 'select-trigger',
            value: 'select-value',
            popoverContent: 'select-popover',
            listbox: 'select-options',
          }}
          size="sm"
          variant="bordered"
          isDisabled={props.disabled}
          disallowEmptySelection
          selectedKeys={[current || '__empty__']}
          onSelectionChange={(keys) => {
            const key = Array.from(keys)[0];
            if (key === undefined || !native.current) return;
            native.current.value = key === '__empty__' ? '' : String(key);
            native.current.dispatchEvent(new Event('change', { bubbles: true }));
          }}
        >
          {options.map((option) => (
            <SelectItem
              key={option.props.value || '__empty__'}
              textValue={option.props.children}
              isDisabled={option.props.disabled}
            >
              {option.props.children}
            </SelectItem>
          ))}
        </Select>
      </Tooltip>
    </>
  );
}
