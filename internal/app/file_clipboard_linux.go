//go:build linux && !android && !server

package app

/*
#cgo gtk3 pkg-config: gtk+-3.0
#cgo !gtk3 pkg-config: gtk4
#include <gtk/gtk.h>
#include <stdlib.h>

#if GTK_MAJOR_VERSION >= 4
typedef struct { GMainLoop *loop; char **uris; GError *error; GCancellable *cancel; } ClipboardRead;
static gboolean cancelClipboardRead(gpointer data) {
    g_cancellable_cancel(((ClipboardRead *)data)->cancel);
    return G_SOURCE_REMOVE;
}
static void clipboardFilesReady(GObject *source, GAsyncResult *result, gpointer data) {
    ClipboardRead *read = data;
    const GValue *value = gdk_clipboard_read_value_finish(GDK_CLIPBOARD(source), result, &read->error);
    if (value) {
        GSList *files = gdk_file_list_get_files(g_value_get_boxed(value));
        guint count = g_slist_length(files);
        if (count <= 64) {
            read->uris = g_new0(char *, count + 1);
            guint i = 0;
            for (GSList *item = files; item; item = item->next) read->uris[i++] = g_file_get_uri(item->data);
        }
    }
    g_main_loop_quit(read->loop);
}
static char **clipboardFileURIs(void) {
    GdkDisplay *display = gdk_display_get_default();
    if (!display) return NULL;
    ClipboardRead read = { .loop = g_main_loop_new(NULL, FALSE), .cancel = g_cancellable_new() };
    guint timer = g_timeout_add(5000, cancelClipboardRead, &read);
    gdk_clipboard_read_value_async(gdk_display_get_clipboard(display), GDK_TYPE_FILE_LIST, G_PRIORITY_DEFAULT, read.cancel, clipboardFilesReady, &read);
    g_main_loop_run(read.loop);
    if (g_main_context_find_source_by_id(NULL, timer)) g_source_remove(timer);
    g_main_loop_unref(read.loop);
    g_object_unref(read.cancel);
    if (read.error) g_error_free(read.error);
    return read.uris;
}
#else
static char **clipboardFileURIs(void) {
    return gtk_clipboard_wait_for_uris(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD));
}
#endif

static const char *clipboardURI(char **uris, int index) { return uris[index]; }
*/
import "C"

import (
	"errors"
	"net/url"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func localClipboardFiles() ([]string, error) {
	var paths []string
	err := application.InvokeSyncWithError(func() error {
		uris := C.clipboardFileURIs()
		if uris == nil {
			return errors.New("无法读取本地文件剪贴板，请复制 1 至 64 个文件后重试")
		}
		defer C.g_strfreev(uris)
		for i := 0; ; i++ {
			item := C.clipboardURI(uris, C.int(i))
			if item == nil {
				break
			}
			if i == 64 {
				return errors.New("每次最多粘贴 64 个文件")
			}
			value, err := url.Parse(C.GoString(item))
			if err != nil || value.Scheme != "file" || value.Host != "" && value.Host != "localhost" || value.RawQuery != "" || value.Fragment != "" {
				return errors.New("剪贴板包含非本机文件地址")
			}
			paths = append(paths, value.Path)
		}
		if len(paths) == 0 {
			return errors.New("剪贴板没有本地文件")
		}
		return nil
	})
	return paths, err
}
