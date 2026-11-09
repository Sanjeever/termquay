package backup

import (
	"context"

	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"github.com/studio-b12/gowebdav"
)

type PruneSnapshot struct {
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	Published time.Time `json:"published"`
	Modified  time.Time `json:"modified"`
	ETag      string    `json:"etag"`
}

var snapshotName = regexp.MustCompile(`^(\d{8}T\d{6}\.\d{9}Z)_[a-f0-9]{32}\.(?:json\.age|tqbackup)$`)
var snapshotDevice = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

func (o WebDAVOptions) Devices(ctx context.Context) ([]string, error) {
	client, err := o.client(ctx)
	if err != nil {
		return nil, err
	}
	entries, err := client.ReadDir(o.Directory)
	if err != nil {
		if gowebdav.IsErrNotFound(err) {
			return []string{}, nil
		}
		return nil, err
	}
	if len(entries) > 1000 {
		return nil, appmessage.New("backend:backupDeviceDirectoriesExceed1000", "备份设备目录超过 1000 个")
	}
	devices := []string{}
	for _, entry := range entries {
		if entry.IsDir() && snapshotDevice.MatchString(entry.Name()) && !strings.HasPrefix(entry.Name(), "termquay-check-") {
			devices = append(devices, entry.Name())
		}
	}
	sort.Strings(devices)
	return devices, nil
}

func (o WebDAVOptions) PlanPrune(ctx context.Context, device string, keep int) (retained, removed []PruneSnapshot, remaining, skipped int, err error) {
	if !snapshotDevice.MatchString(device) || strings.HasPrefix(device, "termquay-check-") || keep < 1 || keep > 1000 {
		err = appmessage.New("backend:invalidDeviceIdentifierOrRetentionCountOutside1", "设备标识无效，或保留数量不在 1 至 1000 之间")
		return
	}
	client, err := o.client(ctx)
	if err != nil {
		return nil, nil, 0, 0, err
	}
	entries, err := client.ReadDir(path.Join(o.Directory, device))
	if err != nil {
		return nil, nil, 0, 0, err
	}
	if len(entries) > 100000 {
		return nil, nil, 0, 0, appmessage.New("backend:deviceDirectoryExceeds100000EntriesCannotGeneratePrune", "设备目录超过 100000 项，无法生成清理预览")
	}
	items := []PruneSnapshot{}
	for _, entry := range entries {
		match := snapshotName.FindStringSubmatch(entry.Name())
		if entry.IsDir() || match == nil {
			skipped++
			continue
		}
		published, e := time.Parse("20060102T150405.000000000Z", match[1])
		if e != nil {
			skipped++
			continue
		}
		etag := ""
		if version, ok := entry.(interface{ ETag() string }); ok {
			etag = version.ETag()
		}
		items = append(items, PruneSnapshot{Path: path.Join(o.Directory, device, entry.Name()), Size: entry.Size(), Published: published, Modified: entry.ModTime(), ETag: etag})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Path > items[j].Path })
	if keep > len(items) {
		keep = len(items)
	}
	retained = items[:keep]
	removed = items[keep:]
	if len(removed) > 1000 {
		remaining = len(removed) - 1000
		removed = removed[len(removed)-1000:]
	}
	return retained, removed, remaining, skipped, nil
}

func (o WebDAVOptions) DeletePreviewedSnapshot(ctx context.Context, item PruneSnapshot) error {
	if path.Clean(item.Path) != item.Path || path.Dir(path.Dir(item.Path)) != o.Directory || !snapshotDevice.MatchString(path.Base(path.Dir(item.Path))) || !snapshotName.MatchString(path.Base(item.Path)) {
		return appmessage.New("backend:prunePathIsOutsideTheDeviceSnapshotDirectory", "清理路径不在设备快照目录内")
	}
	client, err := o.client(ctx)
	if err != nil {
		return err
	}
	info, err := client.Stat(item.Path)
	if err != nil {
		return err
	}
	etag := ""
	if version, ok := info.(interface{ ETag() string }); ok {
		etag = version.ETag()
	}
	if info.IsDir() || info.Size() != item.Size || !info.ModTime().Equal(item.Modified) || etag != item.ETag {
		return appmessage.New("backend:snapshotChangedAfterPreviewPreviewAgain", "快照自预览后已变化，请重新预览")
	}
	address, err := url.JoinPath(o.URL, item.Path)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, address, nil)
	if err != nil {
		return err
	}
	request.SetBasicAuth(o.Username, o.Password)
	if etag != "" && !strings.HasPrefix(etag, "W/") {
		request.Header.Set("If-Match", etag)
	}
	transport := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := transport.Do(request)
	if err != nil {
		return appmessage.Errorf("backend:deletionResultUnconfirmedRefreshToVerify", "删除结果未确认，请刷新核对：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent && response.StatusCode != http.StatusOK {
		return gowebdav.NewPathError("DELETE", item.Path, response.StatusCode)
	}
	return nil
}
