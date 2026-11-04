package app

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#include <stdlib.h>

static char *clipboardFilePaths(void) {
    @autoreleasepool {
        NSArray *urls = [[NSPasteboard generalPasteboard] readObjectsForClasses:@[[NSURL class]] options:@{NSPasteboardURLReadingFileURLsOnlyKey: @YES}];
        if (urls.count > 64) return NULL;
        NSMutableArray *paths = [NSMutableArray array];
        for (NSURL *url in urls) if (url.fileURL && url.path) [paths addObject:url.path];
        NSData *data = [NSJSONSerialization dataWithJSONObject:paths options:0 error:nil];
        return data ? strndup(data.bytes, data.length) : NULL;
    }
}
*/
import "C"

import (
	"encoding/json"
	"errors"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func localClipboardFiles() ([]string, error) {
	var paths []string
	err := application.InvokeSyncWithError(func() error {
		value := C.clipboardFilePaths()
		if value == nil {
			return errors.New("无法读取文件剪贴板或文件超过 64 个")
		}
		defer C.free(unsafe.Pointer(value))
		return json.Unmarshal([]byte(C.GoString(value)), &paths)
	})
	if err == nil && len(paths) == 0 {
		err = errors.New("剪贴板没有本地文件，请先在文件管理器中复制文件")
	}
	return paths, err
}
