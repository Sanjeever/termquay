//go:build darwin && cgo

package app

/*
#include <libproc.h>
#include <sys/proc_info.h>
#include <errno.h>

static int terminal_cwd(int pid, struct proc_vnodepathinfo *info) {
  int size = proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, info, sizeof(*info));
  return size == sizeof(*info) ? 0 : (errno ? errno : EIO);
}
*/
import "C"

import "syscall"

func localProcessDirectory(pid int) (string, error) {
	var info C.struct_proc_vnodepathinfo
	if code := C.terminal_cwd(C.int(pid), &info); code != 0 {
		return "", syscall.Errno(code)
	}
	return C.GoString(&info.pvi_cdir.vip_path[0]), nil
}
