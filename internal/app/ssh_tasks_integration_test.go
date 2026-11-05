package app

import (
	"context"
	"io"
	"net"
	"runtime"
	"strconv"
	"sync"
	"testing"
	"time"

	terminal "github.com/Sanjeever/termquay/internal/ssh"
	"github.com/Sanjeever/termquay/internal/store"
	socks "github.com/armon/go-socks5"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestSG1WorkflowReconnectAndProxy(t *testing.T) {
	r := sg1WorkflowRequest(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	connections := make(chan net.Conn, 4)
	go func() {
		for {
			local, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer local.Close()
				remote, err := net.DialTimeout("tcp", net.JoinHostPort(r.Host, strconv.Itoa(r.Port)), 10*time.Second)
				if err != nil {
					return
				}
				defer remote.Close()
				connections <- local
				go func() { io.Copy(remote, local); remote.Close() }()
				io.Copy(local, remote)
			}()
		}
	}()
	a := testAppStore(t)
	request := r
	address := listener.Addr().(*net.TCPAddr)
	request.Host, request.Port = "127.0.0.1", address.Port
	request.AuthMethod = "private_key"
	connection, err := a.SaveConnection(store.Connection{Name: "真实中断重连", Protocol: "ssh", Host: request.Host, Port: request.Port, Username: request.Username, AuthMethod: "private_key"}, request)
	if err != nil {
		t.Fatal(err)
	}
	request.ConnectionID = connection.ID
	workspace := sg1WorkflowWorkspace(t, a, request)
	a.mu.Lock()
	owner := a.workspaces[workspace]
	a.mu.Unlock()
	select {
	case conn := <-connections:
		conn.Close()
	case <-time.After(10 * time.Second):
		t.Fatal("未取得测试代理连接")
	}
	select {
	case <-owner.ctx.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("连接中断后工作区未关闭")
	}
	expected := []SSHRouteHop{{Host: request.Host, Port: request.Port, Username: request.Username, AuthMethod: "private_key"}}
	reconnected := a.ReconnectSavedSSH(t.Context(), connection.ID, expected)
	if reconnected.Error != "" || reconnected.Result.ID == "" || reconnected.Result.ID == workspace {
		t.Fatalf("真实中断后重连失败: %s", reconnected.Error)
	}
	defer a.CloseWorkspace(reconnected.Result.ID)
	if sg1WorkflowCommand(t, a, reconnected.Result.ID, "printf reconnected").Stdout != "reconnected" {
		t.Fatal("重连后命令不可用")
	}
	expected[0].Port++
	if result := a.ReconnectSavedSSH(t.Context(), connection.ID, expected); result.Error == "" || result.Retryable {
		t.Fatal("连接路径变化仍被自动重试")
	}
	proxy, err := socks.New(&socks.Config{})
	if err != nil {
		t.Fatal(err)
	}
	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer proxyListener.Close()
	go proxy.Serve(proxyListener)
	r.ProxyAddress = proxyListener.Addr().String()
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	proxied, err := terminal.Dial(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	defer proxied.Close()
	result := proxied.RunCommand(ctx, "printf proxy-ok")
	if result.Error != "" || result.ExitCode != 0 || result.Stdout != "proxy-ok" {
		t.Fatal("真实 SOCKS5 路径命令失败")
	}
}

func TestSG1WorkflowTaskApproval(t *testing.T) {
	r := sg1WorkflowRequest(t)
	application.New(application.Options{})
	a := testAppStore(t)
	first := sg1WorkflowWorkspace(t, a, r)
	second := sg1WorkflowWorkspace(t, a, r)
	task := CommandTask{Name: "真实首台确认", FirstHostApproval: true, Steps: []CommandStep{{Name: "只读检查", Script: "printf TERMQUAY_TASK_OK", TimeoutSeconds: 10, Check: &CommandCheck{Kind: "text", Expected: "TERMQUAY_TASK_OK"}}}}
	view, err := a.StartCommandRun(t.Context(), task, []CommandRunTarget{{ID: first}, {ID: second}}, "")
	if err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	run := a.commandRuns[view.ID]
	a.mu.Unlock()
	defer func() { run.cancel(); <-run.done }()
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		record, err := a.GetCommandRun(view.ID)
		if err != nil {
			t.Fatal(err)
		}
		if record.Summary.State == "等待确认" {
			if record.Summary.Completed != 1 || record.Results[0].Check == nil || record.Results[0].Check.State != "pass" || record.Results[1].Result != nil {
				t.Fatal("首台确认前执行了其他目标，或首台判定失败")
			}
			break
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("首台未进入等待确认")
		}
	}
	if err := a.ContinueCommandRun(view.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-run.done:
	case <-time.After(20 * time.Second):
		t.Fatal("首台确认后任务未结束")
	}
	record, err := a.GetCommandRun(view.ID)
	if err != nil || record.Summary.State != "已完成" || record.Summary.Completed != 2 {
		t.Fatalf("多工作区真实任务失败: %v, %+v", err, record.Summary)
	}
	for _, item := range record.Results {
		if item.Result == nil || item.Result.Stdout != "TERMQUAY_TASK_OK" || item.Check == nil || item.Check.State != "pass" {
			t.Fatal("真实任务结果或巡检判定不一致")
		}
	}
}

func TestSG1WorkflowLifecycle(t *testing.T) {
	r := sg1WorkflowRequest(t)
	a := testAppStore(t)
	runtime.GC()
	before := runtime.NumGoroutine()
	for cycle := range 4 {
		workspaces := make([]string, 5)
		for i := range workspaces {
			workspaces[i] = sg1WorkflowWorkspace(t, a, r)
		}
		var workers sync.WaitGroup
		results := make(chan error, len(workspaces))
		for _, workspace := range workspaces {
			workers.Go(func() {
				result, err := a.RunRemoteCommand(t.Context(), workspace, "printf alive", 10)
				if err == nil && (result.Error != "" || result.ExitCode != 0 || result.Stdout != "alive") {
					t.Error("并发独立命令失败")
				}
				results <- err
			})
		}
		workers.Wait()
		close(results)
		for err := range results {
			if err != nil {
				t.Fatal(err)
			}
		}
		tunnel, err := a.StartTunnel(t.Context(), workspaces[0], terminal.ForwardSpec{Kind: "local", BindHost: "127.0.0.1", TargetHost: "127.0.0.1", TargetPort: r.Port})
		if err != nil {
			t.Fatal(err)
		}
		for _, workspace := range workspaces {
			a.CloseWorkspace(workspace)
		}
		listener, err := net.Listen("tcp", tunnel.Info.Address)
		if err != nil {
			t.Fatalf("关闭工作区后本地转发端口未释放: %v", err)
		}
		listener.Close()
		a.mu.Lock()
		remaining := len(a.workspaces) + len(a.terminals) + len(a.tunnels) + a.opening
		a.mu.Unlock()
		if remaining != 0 {
			t.Fatalf("第 %d 轮关闭后存在 %d 个活动资源", cycle+1, remaining)
		}
	}
	runtime.GC()
	t.Logf("20 次真实工作区创建与关闭完成，测试进程 goroutine %d → %d；不代表原生 WebView 内存验收", before, runtime.NumGoroutine())
}
