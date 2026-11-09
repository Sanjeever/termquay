package app

import appmessage "github.com/Sanjeever/termquay/internal/message"

func appendImportNotices(diagnostics *[]string, messages *[]*appmessage.Descriptor, notices ...error) {
	for _, notice := range notices {
		*diagnostics = append(*diagnostics, notice.Error())
		*messages = append(*messages, appmessage.Describe(notice))
	}
}
