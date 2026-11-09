package files

import (
	appmessage "github.com/Sanjeever/termquay/internal/message"
	"path"
	"strings"
)

func ValidateSyncExcludes(patterns []string) error {
	if len(patterns) > 32 {
		return appmessage.New("backend:configureUpTo32ExclusionRules", "最多设置 32 条排除规则")
	}
	for _, pattern := range patterns {
		if pattern == "" || len(pattern) > 256 || strings.ContainsAny(pattern, "\\\x00\r\n") || strings.HasPrefix(pattern, "/") || strings.Contains(pattern, "..") {
			return appmessage.New("backend:exclusionRulesMustBeRelativePathsOrFilename", "排除规则须为相对路径或文件名通配符")
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return err
		}
	}
	return nil
}

func ExcludedSyncPath(name string, patterns []string) bool {
	for _, pattern := range patterns {
		pattern = strings.TrimSuffix(pattern, "/")
		if strings.Contains(pattern, "/") {
			if matched, _ := path.Match(pattern, name); matched {
				return true
			}
		} else {
			for _, part := range strings.Split(name, "/") {
				if matched, _ := path.Match(pattern, part); matched {
					return true
				}
			}
		}
	}
	return false
}
