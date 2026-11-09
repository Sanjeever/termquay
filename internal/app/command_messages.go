package app

// Keep legacy machine state values intact while exposing display-independent codes.
func commandStateCode(state string) string {
	return map[string]string{
		"执行中": "running", "等待": "waiting", "未执行": "not_executed",
		"已取消": "canceled", "失败": "failed", "已完成": "completed", "完成": "completed",
		"通过": "passed", "不通过": "check_failed", "无法判定": "indeterminate",
		"非零退出": "nonzero_exit", "已请求取消": "cancel_requested", "等待确认": "awaiting_confirmation",
	}[state]
}

func commandRecordWithStateCodes(record CommandRunRecord) CommandRunRecord {
	record.Summary.StateCode = commandStateCode(record.Summary.State)
	for index := range record.Results {
		record.Results[index].StateCode = commandStateCode(record.Results[index].State)
	}
	return record
}
