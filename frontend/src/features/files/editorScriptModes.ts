import type { StreamParser } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';

export const makefile: StreamParser<unknown> = {
  name: 'Makefile',
  startState: () => shell.startState?.(2) || {},
  token(stream, state) {
    if (stream.sol() && stream.peek() === '\t') return shell.token(stream, state);
    if (stream.string.startsWith('\t')) return shell.token(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return 'comment';
    if (stream.match(/^\$\([^)]+\)|^\$\{[^}]+\}|^\$[@<^?*%+|]/)) return 'variableName';
    if (stream.sol() && stream.match(/^[^#\s:=]+(?=\s*(?:\?|\+|:)?=)/)) return 'variableName';
    if (stream.match(/^[^#\s:=]+(?=\s*:(?!=))/)) return 'labelName';
    if (
      stream.match(
        /^(?:include|-include|sinclude|ifdef|ifndef|ifeq|ifneq|else|endif|define|endef|export|unexport|override|private|vpath)\b/,
      )
    )
      return 'keyword';
    if (stream.match(/^(?::=|\?=|\+=|!=|::|:|=)/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
};

export const batch: StreamParser<null> = {
  name: 'Windows Batch',
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(?:@?rem\b|::).*/i)) return 'comment';
    if (stream.sol() && stream.match(/^:[^\s]+/)) return 'labelName';
    if (stream.match(/^%[^%\r\n]+%|^![^!\r\n]+!|^%%?[A-Za-z0-9*]/)) return 'variableName';
    if (stream.match(/^"(?:[^"]|"")*"?/)) return 'string';
    if (
      stream.match(
        /^@?(?:echo|set|setlocal|endlocal|if|else|for|in|do|call|goto|exit|shift|not|exist|defined|errorlevel|pushd|popd|cd|dir|copy|move|del|mkdir|rmdir|pause|start|type|title|timeout)\b/i,
      )
    )
      return 'keyword';
    if (stream.match(/^[|&<>^()=]+/)) return 'operator';
    if (stream.match(/^\d+\b/)) return 'number';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: 'rem ' } },
};
