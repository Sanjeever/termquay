# TermQuay · 栈桥

TermQuay 是使用 Go、Wails 和 React 构建的开源跨平台远程连接工作台，目标是将 SSH 终端、远程文件编辑、服务器监控和 RDP 桌面放在统一工作区，支持连接分组与加密 WebDAV 备份。

项目仓库：[Sanjeever/termquay](https://github.com/Sanjeever/termquay)。

## 当前状态

项目处于阶段 0 技术验证。已有 Wails v3 桌面、SSH 连接表单、多工作区终端、密码和私钥认证、主机指纹确认、尺寸同步与有界输出消费确认。macOS arm64 原生窗口已启动并检查界面。SQLite 加密凭据与 age 快照核心已通过隔离跨主密钥恢复测试，尚未接入设置界面。

下列产品规划尚未全部实现，未提供稳定安装包。平台、真实远端和功能验收状态见 [handoff.md](handoff.md)。

RDP 连接表单、IronRDP WASM 工作区和 Go RDCleanPath 桥接已接入，包含 TLS/NLA、证书指纹确认及变化阻止。浏览器 WASM 装载与隔离 TLS 桥接测试通过；真实 Windows 画面、输入、剪贴板和尺寸行为待验证。

## 产品规划

- **连接管理**：SSH 与 RDP 共用嵌套分组，支持搜索、排序、移动和导入导出，连接数量不设置商业限制。
- **SSH 工作区**：左侧远程文件树，中间多标签终端与文件编辑器，右侧服务器监控；面板可调整和收起。
- **SSH 连接**：密码、私钥、加密私钥、交互认证、SSH Agent、主机密钥校验和跳板机。
- **文件操作**：SFTP 浏览、上传下载、传输任务与取消；配置文件在线编辑、未保存状态和远端修改冲突处理。
- **服务器监控**：首版面向 Linux，按需采集 CPU、内存、网络与磁盘信息，默认无需在远端安装常驻组件。
- **远程桌面**：IronRDP 内嵌 RDP 标签页，支持键鼠、远程组合键、文本剪贴板、分辨率调整与全屏。
- **备份恢复**：本地数据与凭据保护、WebDAV 加密历史快照、恢复预览和跨设备恢复。

工作区采用两层标签：外层切换服务器或远程桌面，SSH 工作区内层切换终端和文件。重新打开工作区布局不代表恢复先前的远端 Shell 进程。

首个稳定版覆盖 SSH、内嵌 RDP 和加密跨设备恢复。VNC、Telnet、本地终端、AI、MCP 服务、团队协作和多设备自动合并不在首版范围内。

## 技术方案

| 部分 | 方案 |
| --- | --- |
| 桌面与后端 | Go、Wails v3 |
| 前端 | React、TypeScript、Vite、Tailwind CSS、HeroUI、pnpm |
| 终端与 SSH | xterm.js、`golang.org/x/crypto/ssh`、Wails Streams |
| 文件操作与编辑 | `github.com/pkg/sftp`、CodeMirror 6 |
| RDP | IronRDP WASM、Go RDCleanPath 桥接 |
| 本地数据 | SQLite、加密凭据字段、系统密钥库 |
| 备份 | 带版本的 JSON、`filippo.io/age`、WebDAV |

Go 负责连接、认证、会话生命周期、传输、监控、存储和备份；React 负责界面和编辑草稿。终端字节走有界数据流，控制操作与低频状态分别使用 Wails 服务绑定和事件。

RDP 原型优先验证三平台 WebView、WASM 依赖配套、RDCleanPath 协商、TLS 与 NLA。凭据和备份不得以明文持久化。WebDAV 首版提供追加式快照和手动恢复。

## 实施顺序

| 阶段 | 交付目标 |
| --- | --- |
| 技术验证 | Wails 桌面、真实 SSH 终端、RDP 桥接、加密快照跨设备恢复；记录平台验证结果 |
| SSH 内测版 | 分组与认证、多标签、文件树与编辑、Linux 监控、加密 WebDAV |
| RDP 集成版 | 内嵌桌面、多会话、剪贴板、尺寸与输入完善 |
| 首个稳定版 | 导入迁移、跳板机与端口转发、三平台打包、长期运行验证 |

## 开发入口

需要 Node、pnpm 11.20.0 与 Go。`go.mod` 将项目工具链固定为 Go 1.26.10；系统 Go 支持自动工具链时会按需下载。macOS 需要 Command Line Tools。

```sh
pnpm --dir frontend install --frozen-lockfile
go run github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0 generate bindings -ts
pnpm --dir frontend build
go build -o bin/termquay .
./bin/termquay
go test -race ./internal/...
```

Wails CLI 可安装到项目忽略目录，使用模板开发与打包入口：

```sh
GOTOOLCHAIN=go1.26.10 GOBIN="$PWD/.tools" go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0
PATH="$PWD/.tools:$PATH" .tools/wails3 dev
PATH="$PWD/.tools:$PATH" .tools/wails3 task package
```

SSH 表单中的主机信任目前保留到应用退出，首次连接需要核对指纹。关闭工作区释放 SSH 与终端，切换标签保留会话。凭据不随表单自动持久化。私钥口令、Agent、持久信任和完整连接管理继续按实施阶段补齐。

文档、界面和提交描述使用简体中文。提交遵循 Conventional Commits，按完整且可审阅的小改动提交。

SSH 集成测试使用开发者安全配置的测试连接。密码、私钥、真实服务器配置和本机备份不得提交到仓库。

## 开源许可

计划采用 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)。当前尚未添加 `LICENSE` 文件，正式分发前需补齐许可证和实际依赖要求的第三方声明。

## 参考资料

- [XTerminal 文档](https://docs.xterminal.cn/)：工作区体验与公开连接格式参考。
- [Wails v3](https://wails.io/)：桌面框架与前后端通信。
- [IronRDP](https://github.com/Devolutions/IronRDP)：内嵌远程桌面。
- [xterm.js](https://xtermjs.org/)：终端模拟器。
- [CodeMirror](https://codemirror.net/)：文件编辑器。
- [age](https://github.com/FiloSottile/age)：备份加密。
