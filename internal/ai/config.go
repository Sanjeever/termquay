package ai

import (
	"errors"
	"net/url"
	"strings"
	"time"
)

type Config struct {
	Enabled               bool   `json:"enabled"`
	Protocol              string `json:"protocol"`
	Endpoint              string `json:"endpoint"`
	Model                 string `json:"model"`
	APIKey                string `json:"api_key"`
	ConfirmExec           bool   `json:"confirm_exec"`
	RequestTimeoutMinutes int    `json:"request_timeout_minutes"`
}

const DefaultRequestTimeoutMinutes = 10
const MaxRequestTimeoutMinutes = 30

func DefaultConfig() Config {
	return Config{Protocol: "chat_completions", ConfirmExec: true, RequestTimeoutMinutes: DefaultRequestTimeoutMinutes}
}

func (c Config) RequestTimeout() time.Duration {
	minutes := c.RequestTimeoutMinutes
	if minutes == 0 {
		minutes = DefaultRequestTimeoutMinutes
	}
	return time.Duration(minutes) * time.Minute
}

func (c Config) Validate() error {
	if c.RequestTimeoutMinutes < 0 || c.RequestTimeoutMinutes > MaxRequestTimeoutMinutes {
		return errors.New("模型最长等待时间须为 1 至 30 分钟")
	}
	if c.Protocol != "chat_completions" && c.Protocol != "messages" && c.Protocol != "responses" {
		return errors.New("AI 接口类型无效")
	}
	if len(c.APIKey) > 8192 || strings.ContainsAny(c.APIKey, "\r\n") || len(c.Model) > 256 || len(c.Endpoint) > 4096 {
		return errors.New("AI 配置字段无效或过长")
	}
	if !c.Enabled && c.Endpoint == "" && c.Model == "" {
		return nil
	}
	u, err := url.Parse(c.Endpoint)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
		return errors.New("请输入无凭据、查询参数和片段的完整 HTTP(S) 请求 URL")
	}
	if strings.TrimSpace(c.Model) == "" {
		return errors.New("模型名称不能为空")
	}
	return nil
}
