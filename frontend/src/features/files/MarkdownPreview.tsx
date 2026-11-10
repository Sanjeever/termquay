import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useMessageState } from '../../i18n/useMessageState.ts';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../components/Tooltip';
import {
  Component,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { Browser } from '@wailsio/runtime';
import { HighlightStyle, LanguageSupport, type Language } from '@codemirror/language';
import { highlightTree, tags } from '@lezer/highlight';
import { documentTarget } from './fileTypes';
import useImageResource from './useImageResource';
import { languageFromTag, loadEditorLanguage } from './editorLanguage';
import ErrorNotice from '../../components/ErrorNotice';
import { errorMessage, eventError } from '../../lib/errors.ts';

const codeStyle = HighlightStyle.define([
  { tag: tags.keyword, class: 'md-token-keyword' },
  { tag: tags.string, class: 'md-token-string' },
  { tag: tags.comment, class: 'md-token-comment' },
  { tag: [tags.number, tags.bool, tags.null], class: 'md-token-number' },
  { tag: [tags.typeName, tags.className], class: 'md-token-type' },
  { tag: [tags.propertyName, tags.attributeName], class: 'md-token-property' },
  { tag: tags.function(tags.variableName), class: 'md-token-function' },
]);

function MarkdownCode({ className, children }: { className?: string; children?: ReactNode }) {
  useTranslation();
  const text = String(children ?? '');
  const id = languageFromTag(className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] || '');
  const [tokens, setTokens] = useState<{ text: string; language: string; parts: ReactNode[] }>();
  const [error, setError] = useMessageState('');
  useEffect(() => {
    if (!id || id === 'text' || text.length > 65536) return;
    let ended = false;
    setError('');
    void loadEditorLanguage(id)
      .then((extension) => {
        if (ended) return;
        const language =
          extension instanceof LanguageSupport ? extension.language : (extension as Language);
        const parts: ReactNode[] = [];
        let previous = 0;
        highlightTree(language.parser.parse(text), codeStyle, (from, to, classes) => {
          if (from > previous) parts.push(text.slice(previous, from));
          parts.push(
            <span key={from} className={classes}>
              {text.slice(from, to)}
            </span>,
          );
          previous = to;
        });
        if (previous < text.length) parts.push(text.slice(previous));
        if (!ended) setTokens({ text, language: id, parts });
      })
      .catch((error) => {
        if (!ended) setError(uiMessage('files:couldNotLoadHighlighting', { value1: error }));
      });
    return () => {
      ended = true;
    };
  }, [id, text, setError]);
  return (
    <Tooltip content={error || undefined}>
      <code className={className} data-highlight-error={error ? true : undefined}>
        {tokens?.text === text && tokens.language === id ? tokens.parts : text}
      </code>
    </Tooltip>
  );
}

function MarkdownImage({
  workspace,
  path,
  src,
  alt,
  visible,
  allowed,
  onAllow,
}: {
  workspace: string;
  path: string;
  src?: string;
  alt?: string;
  visible: boolean;
  allowed: ReadonlySet<string>;
  onAllow(address: string): void;
}) {
  useTranslation();
  const target = documentTarget(path, src || '');
  const external = target.kind === 'external';
  const address =
    target.kind === 'remote' ? target.path : target.kind === 'external' ? target.url : '';
  const [near, setNear] = useState(false);
  const [dimensions, setDimensions] = useState<{
    address: string;
    width: number;
    height: number;
  }>();
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: '120px',
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const consent = allowed.has(address);
  const image = useImageResource(
    workspace,
    address,
    visible && near && !!address && (!external || consent),
    external,
  );
  const size = dimensions?.address === address ? dimensions : image.resource?.metadata;
  return (
    <span
      ref={host}
      className="markdown-image"
      style={size ? { width: size.width, aspectRatio: `${size.width}/${size.height}` } : undefined}
    >
      {!address ? (
        <span className="muted">
          {alt || translate('files:image')} {translate('files:unsupportedImageURL')}
        </span>
      ) : external && !consent ? (
        <button
          type="button"
          className="markdown-external-image"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAllow(address);
          }}
        >
          {translate('files:loadImageFrom')}
          {new URL(address).host} {translate('files:message')}
          {alt ? ` · ${alt}` : ''}
        </button>
      ) : errorMessage(eventError(image)) ? (
        <span className="error">
          {errorMessage(eventError(image))}
          <button
            type="button"
            className="session-tool"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              image.retry();
            }}
          >
            {translate('files:retry')}
          </button>
        </span>
      ) : image.resource ? (
        <img
          src={image.resource.url}
          alt={alt || ''}
          draggable={false}
          onLoad={(event) =>
            setDimensions({
              address,
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          onError={image.decodeFailed}
        />
      ) : (
        <span className="muted" role={near ? 'status' : undefined}>
          {near ? translate('files:readingImage') : alt || ''}
        </span>
      )}
    </span>
  );
}

type MarkdownNode = { type: string; children?: MarkdownNode[] };
function limitMarkdownTree() {
  return (tree: MarkdownNode) => {
    const pending = [tree];
    let count = 0;
    while (pending.length) {
      const node = pending.pop()!;
      if (++count > 15000)
        throw uiMessage('files:documentStructureExceedsPreviewLimitsViewTheSource');
      if (node.children) for (const child of node.children) pending.push(child);
    }
  };
}

class PreviewBoundary extends Component<
  { revision: string; children: ReactNode },
  { error: string }
> {
  state = { error: '' };
  static getDerivedStateFromError(error: unknown) {
    return { error: errorMessage(error) };
  }
  componentDidUpdate(previous: Readonly<{ revision: string; children: ReactNode }>) {
    // oxlint-disable-next-line react/no-did-update-set-state -- Reset a failed preview once when its document revision changes.
    if (this.state.error && previous.revision !== this.props.revision) this.setState({ error: '' });
  }
  render() {
    return this.state.error ? (
      <ErrorNotice
        message={translate('files:markdownPreviewFailed', {
          value1: errorMessage(eventError(this.state)),
        })}
      />
    ) : (
      this.props.children
    );
  }
}

export default function MarkdownPreview({
  workspace,
  path,
  content,
  visible,
  focusOnShow,
  anchor,
  onNavigate,
}: {
  workspace: string;
  path: string;
  content: string;
  visible: boolean;
  focusOnShow?: boolean;
  anchor?: { hash: string; sequence: number };
  onNavigate(path: string, hash: string): void;
}) {
  useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const prefix = `md-${useId().replace(/:/g, '')}-`;
  const [rendered, setRendered] = useState(content);
  const [error, setError] = useMessageState('');
  const [allowed, setAllowed] = useState(new Set<string>());
  const callbacks = useRef({ onNavigate, allowed });
  callbacks.current = { onNavigate, allowed };
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setRendered(content), 150);
    return () => clearTimeout(timer);
  }, [content, visible]);
  const scroll = useCallback(
    (hash: string) => {
      try {
        const name = decodeURIComponent(hash.replace(/^#/, ''));
        host.current
          ?.querySelector<HTMLElement>(
            `#${CSS.escape(name.startsWith(prefix) ? name : prefix + name)}`,
          )
          ?.scrollIntoView({ block: 'start' });
      } catch {
        setError(uiMessage('files:invalidDocumentAnchor'));
      }
    },
    [prefix, setError],
  );
  useEffect(() => {
    if (visible && focusOnShow) host.current?.focus();
  }, [visible, focusOnShow]);
  useEffect(() => {
    if (!visible || !anchor) return;
    const frame = requestAnimationFrame(() => scroll(anchor.hash));
    return () => cancelAnimationFrame(frame);
  }, [visible, anchor, rendered, scroll]);
  const components = useMemo(
    () => ({
      code: MarkdownCode,
      img: ({ src, alt }: { src?: string; alt?: string }) => (
        <MarkdownImage
          workspace={workspace}
          path={path}
          src={src}
          alt={alt}
          visible
          allowed={callbacks.current.allowed}
          onAllow={(address) =>
            setAllowed((previous) => {
              const next = new Set(previous);
              if (next.size >= 256) next.delete(next.values().next().value!);
              next.add(address);
              return next;
            })
          }
        />
      ),
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            const target = documentTarget(path, href || '');
            if (target.kind === 'anchor') {
              scroll(target.hash);
              return;
            }
            if (target.kind === 'remote') {
              callbacks.current.onNavigate(target.path, target.hash);
              return;
            }
            if (target.kind === 'external') {
              void Browser.OpenURL(target.url).catch((error) => setError(error));
              return;
            }
            setError(uiMessage('files:thisLinkCannotBeOpenedYet'));
          }}
        >
          {children}
        </a>
      ),
    }),
    [workspace, path, scroll, setError],
  );
  /* oxlint-disable react/exhaustive-deps -- Image approval invalidates cached Markdown; stable image components read the latest approval set through callbacks. */
  const renderedDocument = useMemo(
    () => (
      <PreviewBoundary revision={rendered}>
        <Markdown
          skipHtml
          remarkPlugins={[remarkGfm, limitMarkdownTree]}
          rehypePlugins={[[rehypeSlug, { prefix }]]}
          remarkRehypeOptions={{ clobberPrefix: prefix }}
          components={components}
        >
          {rendered}
        </Markdown>
      </PreviewBoundary>
    ),
    [rendered, components, prefix, allowed],
  );
  /* oxlint-enable react/exhaustive-deps */
  return (
    <div
      className="markdown-preview"
      ref={host}
      tabIndex={0}
      aria-label={translate('files:markdownPreview')}
      data-markdown-preview
    >
      <ErrorNotice message={error} onDismiss={() => setError('')} />
      {visible &&
        (Math.max(content.length, rendered.length) > 512 * 1024 ? (
          <ErrorNotice message={translate('files:markdownExceedsPreviewSizeLimitViewTheSource')} />
        ) : (
          renderedDocument
        ))}
    </div>
  );
}
