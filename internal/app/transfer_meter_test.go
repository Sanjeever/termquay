package app

import (
	"context"
	"testing"
	"time"
)

func TestTransferMeterExcludesResumeOffsetAndDecaysWhenStalled(t *testing.T) {
	meter := transferMeter{}
	start := time.Now()
	if speed := meter.sample(start, 1<<20); speed != 0 {
		t.Fatal("首个采样将续传进度计入速度")
	}
	if speed := meter.sample(start.Add(500*time.Millisecond), (1<<20)+1024); speed != 2048 {
		t.Fatalf("速度计算错误: %d", speed)
	}
	for i := 2; i <= 5; i++ {
		meter.sample(start.Add(time.Duration(i)*500*time.Millisecond), (1<<20)+1024)
	}
	if speed := meter.sample(start.Add(3*time.Second), (1<<20)+1024); speed != 0 {
		t.Fatalf("停滞后保留旧速度: %d", speed)
	}
}

func TestTransferFinishingAndCancellationRemainRunningUntilAcknowledged(t *testing.T) {
	a := NewAppService(BuildInfo{Development: true}, nil)
	a.transferEvent = func(Transfer) {}
	a.workspaces["workspace"] = &workspaceOwner{}
	copied := make(chan struct{})
	release := make(chan struct{})
	view, err := a.startTransfer("workspace", "file", "upload", 10, func(ctx context.Context, report func(int64, int64)) error {
		report(10, 10)
		close(copied)
		<-release
		return ctx.Err()
	})
	if err != nil {
		t.Fatal(err)
	}
	<-copied
	if got := a.ListTransfers()[0]; got.State != "running" || got.Phase != "finishing" {
		t.Fatalf("复制结束提前显示完成: %+v", got)
	}
	a.CancelTransfer(view.ID)
	if got := a.ListTransfers()[0]; got.State != "running" || got.Phase != "cancelling" || got.Speed != 0 || got.RemainingSeconds != -1 {
		t.Fatalf("取消尚未确认时状态错误: %+v", got)
	}
	close(release)
	select {
	case <-a.transfers[view.ID].done:
	case <-time.After(3 * time.Second):
		t.Fatal("取消后任务未释放")
	}
	if got := a.ListTransfers()[0]; got.State != "cancelled" || got.Phase != "" {
		t.Fatalf("取消结束状态错误: %+v", got)
	}
}
