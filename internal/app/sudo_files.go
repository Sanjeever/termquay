package app

import (
	"bytes"
	"context"

	"fmt"
	"strings"
	"time"

	"github.com/Sanjeever/termquay/internal/files"
	appmessage "github.com/Sanjeever/termquay/internal/message"
)

const sudoFilePrelude = `set -eu
test "$(uname -s)" = Linux || { echo 'sudo 编辑仅支持 Linux' >&2; exit 1; }
test -f "$file" && test ! -L "$file" || { echo '请选择普通文件的实际路径' >&2; exit 1; }
test "$(realpath -e -- "$file")" = "$file" || { echo '请使用不经过符号链接的实际路径' >&2; exit 1; }
test "$(stat -c %s -- "$file")" -le "$limit" || { echo '文件超过编辑大小限制' >&2; exit 1; }
revision() {
  hash=$(sha256sum < "$file")
  printf '%s:%s' "${hash%% *}" "$(stat -c '%d:%i:%s:%Y:%f:%u:%g' -- "$file")"
}
`

func sudoQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'" }

func (a *AppService) sudoFile(ctx context.Context, id, remote, password, script string, payload []byte, charset string) (files.Document, error) {
	if err := validateRemotePaths([]string{remote}); err != nil {
		return files.Document{}, err
	}
	if strings.ContainsAny(remote, "\x00\r\n") {
		return files.Document{}, appmessage.New("backend:sudoFilePathCannotContainNewlinesOrNull", "sudo 文件路径不能包含换行或空字符")
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	a.mu.Lock()
	owner := a.workspaces[id]
	if a.commandSlots == nil {
		a.commandSlots = make(chan struct{}, 4)
	}
	slots := a.commandSlots
	a.mu.Unlock()
	if owner == nil {
		return files.Document{}, appmessage.New("backend:sSHWorkspaceClosed", "SSH 工作区已关闭")
	}
	stop := context.AfterFunc(owner.ctx, cancel)
	defer stop()
	select {
	case slots <- struct{}{}:
	case <-ctx.Done():
		return files.Document{}, ctx.Err()
	}
	defer func() { <-slots }()
	data, err := owner.terminal.Sudo(ctx, "file="+sudoQuote(remote)+"\nlimit="+fmt.Sprint(files.MaxEditSize)+"\n"+sudoFilePrelude+script, password, payload, files.MaxEditSize+512)
	if err != nil {
		return files.Document{}, err
	}
	header, content, ok := bytes.Cut(data, []byte{'\n'})
	if !ok || len(header) > 256 {
		return files.Document{}, appmessage.New("backend:invalidSudoFileVersionResponse", "sudo 文件版本响应无效")
	}
	if len(content) > files.MaxEditSize {
		return files.Document{}, appmessage.New("backend:fileExceedsEditingSizeLimit", "文件超过编辑大小限制")
	}
	text, encoding, bom, err := files.DecodeText(content, charset)
	if err != nil {
		return files.Document{}, err
	}
	return files.Document{Path: remote, Content: text, Revision: string(header), Encoding: encoding, BOM: bom, LineEnding: files.LineEnding(text)}, nil
}

func (a *AppService) ReadSudoFile(ctx context.Context, id, remote, charset, password string) (files.Document, error) {
	return a.sudoFile(ctx, id, remote, password, `before=$(revision)
printf '%s\n' "$before"
head -c "$((limit + 1))" -- "$file"
test "$before" = "$(revision)" || { echo '读取期间文件已变化' >&2; exit 1; }
`, nil, charset)
}

func (a *AppService) SaveSudoFile(ctx context.Context, id string, document files.Document, password string) (files.Document, error) {
	if err := a.requireFileWrite(id); err != nil {
		return files.Document{}, err
	}
	history, err := a.GetFileHistory(id, document.Path)
	if err != nil {
		return files.Document{}, err
	}
	if history.Enabled {
		charset := document.OriginalEncoding
		if charset == "" {
			charset = document.Encoding
		}
		previous, err := a.ReadSudoFile(ctx, id, document.Path, charset, password)
		if err != nil {
			return files.Document{}, err
		}
		if previous.Revision != document.Revision {
			return files.Document{}, appmessage.New("backend:remoteFileChangedCompareAndMergeFirst", "远端文件已变化，请先对比与合并")
		}
		if err := a.recordFileVersion(id, previous); err != nil {
			return files.Document{}, err
		}
	}
	data, err := files.EncodeDocument(document)
	if err != nil {
		return files.Document{}, err
	}
	if data == nil {
		data = []byte{}
	}
	if len(document.Revision) == 0 || len(document.Revision) > 256 {
		return files.Document{}, appmessage.New("backend:invalidFileVersionReadItAgain", "文件版本无效，请重新读取")
	}
	script := "expected=" + sudoQuote(document.Revision) + "\n" + `test "$expected" = "$(revision)" || { echo '远端文件已变化，请先对比与合并' >&2; exit 1; }
mode=$(stat -c %a -- "$file")
test "$((0$mode & 07000))" -eq 0 || { echo '不支持含特殊权限位的文件' >&2; exit 1; }
parent=$(dirname -- "$file")
parent_mode=$(stat -c %a -- "$parent")
test "$((0$parent_mode & 0022))" -eq 0 || { echo '目标目录允许其他用户改写' >&2; exit 1; }
umask 077
staging=$(mktemp -d -- "$parent/.termquay-sudo-XXXXXXXXXX")
trap 'rm -f -- "$staging/data"; rmdir -- "$staging"' EXIT
cat > "$staging/data"
test "$(stat -c %s -- "$staging/data")" -eq ` + fmt.Sprint(len(data)) + ` || { echo '文件写入不完整' >&2; exit 1; }
cp --attributes-only --preserve=mode,ownership,xattr -- "$file" "$staging/data"
test "$expected" = "$(revision)" || { echo '写入期间远端文件已变化' >&2; exit 1; }
mv -fT -- "$staging/data" "$file"
printf '%s\n' "$(revision)"
head -c "$((limit + 1))" -- "$file"
`
	return a.sudoFile(ctx, id, document.Path, password, script, data, document.Encoding)
}
