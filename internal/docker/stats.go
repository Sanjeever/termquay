package docker

import (
	"context"

	appmessage "github.com/Sanjeever/termquay/internal/message"
	"time"
)

type Stats struct {
	Time         time.Time `json:"time"`
	CPU          *float64  `json:"cpu"`
	Memory       *uint64   `json:"memory"`
	MemoryLimit  *uint64   `json:"memory_limit"`
	NetworkRead  *uint64   `json:"network_read"`
	NetworkWrite *uint64   `json:"network_write"`
	DiskRead     *uint64   `json:"disk_read"`
	DiskWrite    *uint64   `json:"disk_write"`
}
type cpuSample struct {
	CPUUsage struct {
		TotalUsage  uint64   `json:"total_usage"`
		PerCPUUsage []uint64 `json:"percpu_usage"`
	} `json:"cpu_usage"`
	System uint64 `json:"system_cpu_usage"`
	Online uint64 `json:"online_cpus"`
}

func (c *Client) Stats(ctx context.Context, id string) (Stats, error) {
	if !validID(id) {
		return Stats{}, appmessage.New("backend:invalidContainerID", "容器 ID 无效")
	}
	var raw struct {
		Read     time.Time `json:"read"`
		CPU      cpuSample `json:"cpu_stats"`
		Previous cpuSample `json:"precpu_stats"`
		Memory   *struct {
			Usage uint64 `json:"usage"`
			Limit uint64 `json:"limit"`
		} `json:"memory_stats"`
		Networks map[string]struct {
			Read  uint64 `json:"rx_bytes"`
			Write uint64 `json:"tx_bytes"`
		} `json:"networks"`
		Block struct {
			Entries []struct {
				Op    string `json:"op"`
				Value uint64 `json:"value"`
			} `json:"io_service_bytes_recursive"`
		} `json:"blkio_stats"`
	}
	if err := c.json(ctx, "GET", "/containers/"+id+"/stats?stream=false", nil, &raw); err != nil {
		return Stats{}, err
	}
	if raw.Read.IsZero() {
		return Stats{}, appmessage.New("backend:containerSampleHasNoTimestamp", "容器采样缺少时间")
	}
	view := Stats{Time: raw.Read}
	count := raw.CPU.Online
	if count == 0 {
		count = uint64(len(raw.CPU.CPUUsage.PerCPUUsage))
	}
	if raw.CPU.System > raw.Previous.System && raw.Previous.System > 0 && raw.CPU.CPUUsage.TotalUsage >= raw.Previous.CPUUsage.TotalUsage && count > 0 {
		value := float64(raw.CPU.CPUUsage.TotalUsage-raw.Previous.CPUUsage.TotalUsage) / float64(raw.CPU.System-raw.Previous.System) * float64(count) * 100
		view.CPU = &value
	}
	if raw.Memory != nil {
		view.Memory = &raw.Memory.Usage
		if raw.Memory.Limit > 0 {
			view.MemoryLimit = &raw.Memory.Limit
		}
	}
	if raw.Networks != nil {
		var read, write uint64
		for _, item := range raw.Networks {
			read += item.Read
			write += item.Write
		}
		view.NetworkRead = &read
		view.NetworkWrite = &write
	}
	if raw.Block.Entries != nil {
		var read, write uint64
		for _, item := range raw.Block.Entries {
			if item.Op == "Read" {
				read += item.Value
			}
			if item.Op == "Write" {
				write += item.Value
			}
		}
		view.DiskRead = &read
		view.DiskWrite = &write
	}
	return view, nil
}

func (c *Client) ChangeState(ctx context.Context, id, action string) error {
	if !validID(id) {
		return appmessage.New("backend:invalidContainerID", "容器 ID 无效")
	}
	query := ""
	switch action {
	case "start":
	case "stop", "restart":
		query = "?t=10"
	default:
		return appmessage.New("backend:invalidContainerOperation", "容器操作无效")
	}
	return c.json(ctx, "POST", "/containers/"+id+"/"+action+query, nil, nil)
}
