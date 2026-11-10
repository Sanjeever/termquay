import { fileIconKind } from './fileIcons';

const badges: Record<string, [string, string]> = {
  typescript: ['TS', '#3178c6'],
  javascript: ['JS', '#d4ab22'],
  go: ['Go', '#0095b8'],
  yaml: ['Y', '#c94570'],
  toml: ['T', '#9b6b44'],
  java: ['J', '#c34b35'],
  rust: ['R', '#a76543'],
  c: ['C', '#527cb0'],
  cpp: ['C+', '#527cb0'],
  csharp: ['C#', '#8058aa'],
  swift: ['S', '#de643d'],
  kotlin: ['K', '#9460bd'],
  ruby: ['Rb', '#bf4141'],
  php: ['php', '#737db4'],
  lua: ['Lua', '#6264b2'],
  nginx: ['N', '#398646'],
  pdf: ['PDF', '#c74444'],
  document: ['W', '#3e78ae'],
  font: ['Aa', '#b36a8b'],
  license: ['©', '#9b8543'],
  text: ['txt', '#7a8898'],
  log: ['log', '#7a8898'],
};

export default function FileIcon({
  name,
  directory,
  symlink,
  mode,
  expanded = false,
}: {
  name: string;
  directory: boolean;
  symlink: boolean;
  mode: string;
  expanded?: boolean;
}) {
  const kind = fileIconKind({ name, directory, symlink, mode });
  const folder = kind.startsWith('folder');
  const badge = badges[kind];
  const color = folder
    ? kind === 'folder'
      ? '#d8ad3f'
      : kind === 'folder-git'
        ? '#cf694e'
        : '#4d99b8'
    : badge?.[1] ||
      (
        {
          json: '#bc9834',
          config: '#7b8da0',
          shell: '#5a9b72',
          executable: '#5a9b72',
          git: '#d0664c',
          docker: '#368fbd',
          react: '#3b9bb7',
          vue: '#45956e',
          python: '#4384b3',
          html: '#d46b48',
          xml: '#b48139',
          css: '#6d78be',
          database: '#9274b4',
          package: '#bd665a',
          markdown: '#5d8cad',
          archive: '#b28b4a',
          image: '#a575b3',
          video: '#b1768b',
          audio: '#ad7dad',
          lock: '#a18a45',
          link: '#7c9ab0',
        } as Record<string, string>
      )[kind] ||
      '#8d99a7';
  return (
    <svg
      className="file-type-icon"
      data-file-icon={kind}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ color }}
    >
      {folder ? (
        <>
          <path
            d={expanded ? 'M2 6h8l2 2h9v4H6L2 21V6Z' : 'M2 6h8l2 2h10v13H2V6Z'}
            fill="currentColor"
          />
          {expanded && (
            <path
              d="M6 12h17l-3 9H2l4-9Z"
              fill="currentColor"
              stroke="var(--color-surface)"
              strokeWidth=".8"
            />
          )}
          {kind === 'folder-secure' && (
            <g transform="translate(11 11)" stroke="var(--color-surface)" strokeWidth="1.7">
              <rect x="1" y="4" width="8" height="6" rx="1" />
              <path d="M3 4V2a2 2 0 0 1 4 0v2" />
            </g>
          )}
          {kind === 'folder-git' && (
            <path d="M12 12v6m0-3h5v-3" stroke="var(--color-surface)" strokeWidth="1.6" />
          )}
          {kind === 'folder-config' && (
            <g transform="translate(16 16)" stroke="var(--color-surface)" strokeWidth="1.5">
              <circle r="2.5" />
              <path d="M0-5v2M0 3v2M-5 0h2M3 0h2M-3.5-3.5l1.4 1.4M2.1 2.1l1.4 1.4M-3.5 3.5l1.4-1.4M2.1-2.1l1.4-1.4" />
            </g>
          )}
          {kind === 'folder-code' && (
            <path d="m13 12-3 3 3 3m4-6 3 3-3 3" stroke="var(--color-surface)" strokeWidth="1.5" />
          )}
          {['folder-package', 'folder-docker'].includes(kind) && (
            <path
              d="M12 12h7v7h-7zM12 15h7m-3.5-3v7"
              stroke="var(--color-surface)"
              strokeWidth="1.2"
            />
          )}
        </>
      ) : badge ? (
        <>
          {['typescript', 'javascript'].includes(kind) ? (
            <rect x="2" y="2" width="20" height="20" rx="1.5" fill="currentColor" />
          ) : (
            <>
              <path d="M5 2h9l5 5v15H5V2Z" fill="currentColor" opacity=".18" />
              <path d="M5 2h9l5 5v15H5V2Zm9 0v6h5" stroke="currentColor" strokeWidth="1.2" />
              <rect x="6" y="12" width="17" height="10" rx="1" fill="currentColor" />
            </>
          )}
          <text
            x={['typescript', 'javascript'].includes(kind) ? 13 : 14.5}
            y="19.5"
            textAnchor="middle"
            fill={kind === 'javascript' ? '#1e232a' : '#fff'}
            fontSize={badge[0].length > 2 ? '7' : '9'}
            fontWeight="700"
            fontFamily="var(--font-mono)"
          >
            {badge[0]}
          </text>
        </>
      ) : kind === 'python' ? (
        <>
          <path
            d="M12 2c-6 0-6 2-6 6h7v2H4c-3 0-3 9 1 9h3v-5c0-2 2-3 4-3h5V5c0-2-2-3-5-3Z"
            fill="#4384b3"
          />
          <path
            d="M12 22c6 0 6-2 6-6h-7v-2h9c3 0 3-9-1-9h-3v5c0 2-2 3-4 3H7v6c0 2 2 3 5 3Z"
            fill="#d2ad42"
          />
          <circle cx="9" cy="5" r="1" fill="#fff" />
          <circle cx="15" cy="19" r="1" fill="#fff" />
        </>
      ) : kind === 'react' ? (
        <g stroke="currentColor" strokeWidth="1.3">
          <ellipse cx="12" cy="12" rx="10" ry="4" />
          <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
          <circle cx="12" cy="12" r="1.7" fill="currentColor" />
        </g>
      ) : kind === 'vue' ? (
        <>
          <path d="m2 4 10 17L22 4h-5l-5 9-5-9H2Z" fill="currentColor" />
          <path d="m7 4 5 9 5-9h-3l-2 4-2-4H7Z" fill="#43556a" />
        </>
      ) : (
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {kind === 'json' ? (
            <path d="M9 3H7v7l-3 2 3 2v7h2m6-18h2v7l3 2-3 2v7h-2" />
          ) : ['shell', 'executable'].includes(kind) ? (
            <>
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m6 8 4 4-4 4m7 0h5" />
            </>
          ) : kind === 'config' ? (
            <>
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
              <path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3" />
            </>
          ) : kind === 'git' ? (
            <>
              <path d="m12 2 10 10-10 10L2 12 12 2Z" fill="currentColor" stroke="none" />
              <path d="m8 8 8 8m-4-4v6" stroke="var(--color-surface)" />
              <circle cx="8" cy="8" r="1" fill="var(--color-surface)" />
              <circle cx="16" cy="16" r="1" fill="var(--color-surface)" />
            </>
          ) : kind === 'docker' ? (
            <>
              <path
                d="M2 12h17l3-3v5c-2 5-5 7-11 7-5 0-8-3-9-9Z"
                fill="currentColor"
                stroke="none"
              />
              <path
                d="M5 8h4v4H5zm5 0h4v4h-4zm0-5h4v4h-4zm5 5h4v4h-4z"
                fill="currentColor"
                stroke="none"
              />
            </>
          ) : kind === 'package' || kind === 'archive' ? (
            <>
              <path d="m3 7 9-5 9 5v11l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v11M7 5l10 5v5" />
            </>
          ) : kind === 'database' ? (
            <>
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0" />
            </>
          ) : kind === 'image' ? (
            <>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8" cy="8" r="2" />
              <path d="m3 18 6-6 4 4 4-6 4 7" />
            </>
          ) : kind === 'video' ? (
            <>
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m10 8 6 4-6 4V8Z" fill="currentColor" />
            </>
          ) : kind === 'audio' ? (
            <>
              <path d="M9 17V5l11-3v12M9 8l11-3" />
              <ellipse cx="6" cy="18" rx="3" ry="2" />
              <ellipse cx="17" cy="15" rx="3" ry="2" />
            </>
          ) : kind === 'lock' ? (
            <>
              <rect x="4" y="10" width="16" height="12" rx="2" />
              <path d="M7 10V6a5 5 0 0 1 10 0v4m-5 5v3" />
            </>
          ) : kind === 'link' ? (
            <>
              <path d="m9 8 3-3a5 5 0 0 1 7 7l-3 3m-1 1-3 3a5 5 0 0 1-7-7l3-3m1 6 6-6" />
            </>
          ) : kind === 'markdown' ? (
            <>
              <rect x="2" y="5" width="20" height="14" rx="1" />
              <path d="M5 16V8l3 4 3-4v8m6-8v8m-2-2 2 2 2-2" />
            </>
          ) : kind === 'spreadsheet' ? (
            <>
              <rect x="3" y="2" width="18" height="20" rx="1" />
              <path d="M3 8h18M3 14h18M9 8v14m6-14v14" />
            </>
          ) : ['html', 'xml', 'css'].includes(kind) ? (
            <>
              <path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-3 18" />
            </>
          ) : (
            <>
              <path d="M5 2h9l5 5v15H5V2Zm9 0v6h5M8 13h8m-8 4h6" />
            </>
          )}
        </g>
      )}
    </svg>
  );
}
