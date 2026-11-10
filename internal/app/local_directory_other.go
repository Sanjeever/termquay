//go:build !linux && (!darwin || !cgo)

package app

func localProcessDirectory(pid int) (string, error) {
	return "", nil
}
