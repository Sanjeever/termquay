# TermQuay · 栈桥

TermQuay 是使用 Go、Wails 和 React 构建的开源跨平台远程连接工作台，目标是将 SSH 终端、远程文件编辑、服务器监控和 RDP 桌面放在统一工作区，支持连接分组与加密 WebDAV 备份。

项目仓库：[Sanjeever/termquay](https://github.com/Sanjeever/termquay)。

## 当前状态

项目处于阶段 0 技术验证与阶段 1 初步实施。已有 Wails v3 桌面、连接与分组持久化、搜索筛选、多工作区终端、密码和加密私钥认证、主机指纹确认、尺寸同步与有界输出消费确认。macOS arm64 原生窗口已启动并检查界面。系统密钥库保护本地主密钥，SQLite 加密凭据；密钥库不可用时可明确选择会话存储。

备份界面支持 WebDAV 加密快照、凭据携带选择、恢复差异预览和确认。两个隔离数据目录使用不同主密钥的恢复测试通过；恢复保留本机设置与信任记录，并拒绝过期或本地数据已变化的预览。真实 WebDAV 兼容性仍在验证，服务商可能要求使用已有可写集合下的相对目录。

下列产品规划尚未全部实现，未提供稳定安装包。平台、真实远端和功能验收状态见 [handoff.md](handoff.md)。

RDP 连接表单、IronRDP WASM 工作区和 Go RDCleanPath 桥接已接入，包含 TLS/NLA、证书指纹确认、变化与过期阻止。macOS 原生 WebView 的 WASM 装载及隔离 TLS 桥接测试通过；真实 Windows 画面、输入、剪贴板和尺寸行为待验证。

SSH 工作区已有独立多 PTY、SFTP 浏览与基本目录操作、CodeMirror 文件标签、草稿与保存冲突检测，以及按需 Linux 监控。在线编辑支持 2 MiB 内 UTF-8 普通文件；保存要求服务端支持 POSIX rename。macOS 原生 WebView 已完成真实 SSH、SFTP 编辑、监控和 512 KiB 终端输出验证。本地测试逐字节核对 4 MiB 输出，并覆盖背压期间输入与 100 次 PTY 创建关闭。

保存会保留服务端报告的 POSIX 权限、属主与用户组，含特殊权限位的文件拒绝在线保存。暂存内容先写入同文件系统的 `0700` 私有目录；可被其他用户任意改写且没有 sticky bit 的目标目录会被拒绝。当前不保留 ACL 和扩展属性，网络中断后可能需要清理私有临时目录。

上传下载任务已接入原生文件选择、进度与取消，最多两个并行任务；收起面板不取消任务，关闭工作区会取消并尝试清理。原生文件选择到完整传输的流程和大文件负载仍待验证。

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
go run github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0 generate bindings -ts -i
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

macOS 本地应用包生成到 `bin/termquay.app`，使用本机 ad-hoc 签名。Windows amd64 已交叉编译，尚未完成 Windows 原生运行；Linux 与其他架构仍待原生验证。当前不是正式发行包。

RDP 验证可在连接中心选择 RDP，填写目标、端口、用户名和可选域。自签名证书需核对指纹；过期证书和已知身份变化会被阻止。工作区提供组合键、文本剪贴板开关、分辨率与全屏。真实目标尚未验证，多会话与中文输入也待实测。

首次连接需要核对 SSH 主机或 RDP 证书指纹。已打开持久存储时，信任保存在本机；会话模式下退出即释放。关闭工作区释放连接，切换标签保留会话。连接表单通过“保存连接”明确保存加密凭据，普通连接操作不自动保存。

文档、界面和提交描述使用简体中文。提交遵循 Conventional Commits，按完整且可审阅的小改动提交。

SSH 集成测试使用开发者安全配置的测试连接。密码、私钥、真实服务器配置和本机备份不得提交到仓库。

## 开源许可

项目采用 [Apache License 2.0](LICENSE)。依赖许可原文位于 `build/licenses`，来源与待核对事项见 [第三方依赖声明](THIRD_PARTY_NOTICES.md)。预构建 WASM 的 Rust 依赖声明及一个未附许可原文的前端依赖仍需完成发行审计。

## 参考资料

- [XTerminal 文档](https://docs.xterminal.cn/)：工作区体验与公开连接格式参考。
- [Wails v3](https://wails.io/)：桌面框架与前后端通信。
- [IronRDP](https://github.com/Devolutions/IronRDP)：内嵌远程桌面。
- [xterm.js](https://xtermjs.org/)：终端模拟器。
- [CodeMirror](https://codemirror.net/)：文件编辑器。
- [age](https://github.com/FiloSottile/age)：备份加密。
