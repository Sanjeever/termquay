package app

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

static void titlebarDoubleClick(void *handle) {
    NSWindow *window = (NSWindow *)handle;
    if (window.styleMask & NSWindowStyleMaskFullScreen) return;
    NSString *action = [[NSUserDefaults standardUserDefaults] stringForKey:@"AppleActionOnDoubleClick"];
    if ([action isEqualToString:@"Minimize"]) {
        [window performMiniaturize:nil];
    } else if ([action isEqualToString:@"Fill"]) {
        static char restoreFrameKey;
        NSRect visible = window.screen.visibleFrame;
        NSValue *previous = objc_getAssociatedObject(window, &restoreFrameKey);
        if (previous && NSEqualRects(window.frame, visible)) {
            [window setFrame:previous.rectValue display:YES animate:YES];
            objc_setAssociatedObject(window, &restoreFrameKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        } else {
            objc_setAssociatedObject(window, &restoreFrameKey, [NSValue valueWithRect:window.frame], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            [window setFrame:visible display:YES animate:YES];
        }
    } else if (!action || [action isEqualToString:@"Maximize"]) {
        [window performZoom:nil];
    }
}
*/
import "C"

import (
	"errors"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *AppService) TitlebarDoubleClick() error {
	return application.InvokeSyncWithError(func() error {
		window, ok := application.Get().Window.GetByName("workbench")
		if !ok {
			return errors.New("工作台窗口已关闭")
		}
		C.titlebarDoubleClick(window.(*application.WebviewWindow).NativeWindow())
		return nil
	})
}
