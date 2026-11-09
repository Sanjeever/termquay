package files

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	sftp "github.com/pkg/sftp/v2"
)

const MaxSearchEntries = 10000
const MaxSearchMatches = 500
const MaxSearchFileBytes = 2 << 20
const MaxSearchReadBytes = 32 << 20
const maxSearchDepth = 32
const maxSearchPathBytes = 8 << 20

type SearchOptions struct {
	Root          string   `json:"root"`
	Query         string   `json:"query"`
	Content       bool     `json:"content"`
	CaseSensitive bool     `json:"case_sensitive"`
	Regex         bool     `json:"regex"`
	Exclude       []string `json:"exclude"`
}

type SearchMatch struct {
	Path      string `json:"path"`
	Directory bool   `json:"directory"`
	Line      int    `json:"line"`
	Text      string `json:"text"`
}

type SearchIssue struct {
	Path         string                 `json:"path"`
	Error        string                 `json:"error"`
	ErrorMessage *appmessage.Descriptor `json:"error_message,omitempty"`
}

type SearchResult struct {
	Root          string                 `json:"root"`
	Matches       []SearchMatch          `json:"matches"`
	Scanned       int                    `json:"scanned"`
	ReadBytes     int64                  `json:"read_bytes"`
	SkippedLarge  int                    `json:"skipped_large"`
	SkippedBinary int                    `json:"skipped_binary"`
	Failed        int                    `json:"failed"`
	Issues        []SearchIssue          `json:"issues"`
	StopReason    string                 `json:"stop_reason"`
	StopMessage   *appmessage.Descriptor `json:"stop_message,omitempty"`
}

func (options SearchOptions) Validate() error {
	if !path.IsAbs(options.Root) || len(options.Root) > 4096 || strings.ContainsRune(options.Root, 0) {
		return appmessage.New("backend:searchScopeMustBeAnAbsoluteRemoteDirectory", "搜索范围须为远端绝对目录")
	}
	if options.Query == "" || len(options.Query) > 512 || !utf8.ValidString(options.Query) || strings.ContainsRune(options.Query, 0) || strings.ContainsAny(options.Query, "\r\n") {
		return appmessage.New("backend:searchTextMustBeASingleLineWithin", "搜索内容须为单行文本，最多 512 字节")
	}
	if err := ValidateSyncExcludes(options.Exclude); err != nil {
		return err
	}
	_, err := searchExpression(options)
	return err
}

func searchExpression(options SearchOptions) (*regexp.Regexp, error) {
	query := options.Query
	if !options.Regex {
		query = regexp.QuoteMeta(query)
	}
	if !options.CaseSensitive {
		query = "(?i)" + query
	}
	return regexp.Compile(query)
}

func Search(ctx context.Context, client *sftp.Client, options SearchOptions) (SearchResult, error) {
	result := SearchResult{Matches: []SearchMatch{}, Issues: []SearchIssue{}}
	if err := options.Validate(); err != nil {
		return result, err
	}
	expression, err := searchExpression(options)
	if err != nil {
		return result, err
	}
	result.Root, err = client.RealPath(options.Root)
	if err != nil {
		return result, err
	}
	rootInfo, err := client.LStat(result.Root)
	if err != nil {
		return result, err
	}
	if !rootInfo.IsDir() {
		return result, appmessage.New("backend:searchScopeMustBeADirectory", "搜索范围必须是目录")
	}
	issue := func(remote string, err error) {
		result.Failed++
		if len(result.Issues) < 16 {
			result.Issues = append(result.Issues, SearchIssue{Path: remote, Error: err.Error(), ErrorMessage: appmessage.Describe(err)})
		}
	}
	pending := []string{""}
	pathBytes := 0
	for len(pending) > 0 {
		if ctx.Err() != nil {
			result.StopReason = "搜索已取消或超时"
			result.StopMessage = appmessage.Describe(appmessage.New("backend:searchCanceledOrTimedOut", "搜索已取消或超时"))
			break
		}
		relative := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		remote := path.Join(result.Root, relative)
		directory, err := client.OpenDir(remote)
		if err != nil {
			if relative == "" {
				return result, err
			}
			issue(remote, err)
			continue
		}
		for {
			entries, readErr := directory.ReaddirContext(ctx, 128)
			for _, info := range entries {
				if ctx.Err() != nil {
					result.StopReason = "搜索已取消或超时"
					result.StopMessage = appmessage.Describe(appmessage.New("backend:searchCanceledOrTimedOut", "搜索已取消或超时"))
					break
				}
				if info.Name() == "." || info.Name() == ".." {
					continue
				}
				name := path.Join(relative, info.Name())
				pathBytes += len(name)
				if info.Name() != path.Base(info.Name()) || len(name)+len(result.Root)+1 > 4096 || strings.ContainsRune(name, 0) {
					issue(remote, appmessage.New("backend:directoryReturnedAnInvalidOrOversizedPath", "目录返回无效或过长的路径"))
					continue
				}
				if result.Scanned >= MaxSearchEntries || pathBytes > maxSearchPathBytes {
					result.StopReason = "已达到目录扫描上限，请缩小搜索范围"
					result.StopMessage = appmessage.Describe(appmessage.New("backend:searchDirectoryLimit", "已达到目录扫描上限，请缩小搜索范围"))
					break
				}
				result.Scanned++
				if ExcludedSyncPath(name, options.Exclude) || info.Mode()&os.ModeSymlink != 0 || !(info.IsDir() || info.Mode().IsRegular()) {
					continue
				}
				entryPath := path.Join(result.Root, name)
				if info.IsDir() {
					if strings.Count(name, "/") < maxSearchDepth {
						pending = append(pending, name)
					} else {
						issue(entryPath, appmessage.New("backend:directoryExceedsSearchDepthLimitFurtherScanningStopped", "目录超过搜索深度上限，未继续扫描"))
					}
				}
				if !options.Content {
					if expression.MatchString(info.Name()) {
						result.Matches = append(result.Matches, SearchMatch{Path: entryPath, Directory: info.IsDir()})
					}
				} else if info.Mode().IsRegular() {
					if info.Size() > MaxSearchFileBytes {
						result.SkippedLarge++
						continue
					}
					if result.ReadBytes >= MaxSearchReadBytes {
						result.StopReason = "已达到内容读取上限，请缩小搜索范围"
						result.StopMessage = appmessage.Describe(appmessage.New("backend:searchReadLimit", "已达到内容读取上限，请缩小搜索范围"))
						break
					}
					file, err := client.Open(entryPath)
					if err != nil {
						issue(entryPath, err)
						continue
					}
					limit := min(int64(MaxSearchFileBytes+1), int64(MaxSearchReadBytes)-result.ReadBytes)
					data, err := io.ReadAll(io.LimitReader(file, limit))
					file.Close()
					result.ReadBytes += int64(len(data))
					if err != nil {
						issue(entryPath, err)
						continue
					}
					if len(data) > MaxSearchFileBytes {
						result.SkippedLarge++
						continue
					}
					if int64(len(data)) == limit && limit <= MaxSearchFileBytes {
						result.StopReason = "已达到内容读取上限，当前文件未完整搜索"
						result.StopMessage = appmessage.Describe(appmessage.New("backend:searchFileReadLimit", "已达到内容读取上限，当前文件未完整搜索"))
						break
					}
					if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
						result.SkippedBinary++
						continue
					}
					line := 0
					for text := range strings.SplitSeq(string(data), "\n") {
						line++
						if location := expression.FindStringIndex(text); location != nil {
							start := max(0, location[0]-100)
							for start > 0 && !utf8.RuneStart(text[start]) {
								start--
							}
							end := min(len(text), start+512)
							for end < len(text) && !utf8.RuneStart(text[end]) {
								end--
							}
							result.Matches = append(result.Matches, SearchMatch{Path: entryPath, Line: line, Text: strings.TrimSuffix(text[start:end], "\r")})
							if len(result.Matches) >= MaxSearchMatches {
								break
							}
						}
					}
				}
				if len(result.Matches) >= MaxSearchMatches {
					result.StopReason = "已达到搜索结果上限，请缩小搜索范围"
					result.StopMessage = appmessage.Describe(appmessage.New("backend:searchResultLimit", "已达到搜索结果上限，请缩小搜索范围"))
					break
				}
			}
			if result.StopReason != "" {
				break
			}
			if readErr != nil {
				if !errors.Is(readErr, io.EOF) {
					issue(remote, readErr)
				}
				break
			}
		}
		directory.Close()
		if result.StopReason != "" {
			break
		}
	}
	if ctx.Err() != nil && result.StopReason == "" {
		result.StopReason = "搜索已取消或超时"
		result.StopMessage = appmessage.Describe(appmessage.New("backend:searchCanceledOrTimedOut", "搜索已取消或超时"))
	}
	return result, nil
}
