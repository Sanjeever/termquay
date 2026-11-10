package app

import (
	"os"
	"strconv"
)

func localProcessDirectory(pid int) (string, error) {
	return os.Readlink("/proc/" + strconv.Itoa(pid) + "/cwd")
}
