# TermQuay · 栈桥

TermQuay 是使用 Go、Wails v3 和 React 构建的开源远程连接工作台，将 SSH、本地终端、远程文件编辑、Linux 监控和内嵌 RDP 放在统一桌面工作区，支持连接分组与加密 WebDAV 备份。连接数量不设置商业限制。

支持 macOS、Windows 和 Linux。从 [GitHub Releases](https://github.com/Sanjeever/termquay/releases) 下载对应平台的压缩包；运行前提、候选包验证与发布流程见 [开发说明](docs/development.md#版本与发布)。

## 当前能力

- 连接分组、搜索、收藏、最近记录与 OpenSSH / PuTTY 预览导入；凭据加密保存，支持显式复用与统一更新。
- SSH 多种认证、用户证书、跳板链、SOCKS5 代理与端口转发；多工作区、独立终端、双窗格和可选自动重连。
- SFTP 多编码文件编辑、多语言高亮与补全、JSON/YAML 语法提示、冲突合并，以及 Markdown 和常见图片预览。
- 批量传输、显式续传与单向目录同步；大日志按片段读取和跟随。
- 本地 Shell / WSL 终端，终端查找、片段、多主机命令与 tmux 入口；Bash/Zsh 可主动启用 POSIX 命令补全与路径提示，离线命令参考独立可用。
- 工作布局、可选加密草稿恢复，以及外观和快捷键设置。
- 按需 Linux 监控，提供趋势与文件系统容量，区分未知、过期和采集失败。
- 内嵌 RDP、经 SSH 访问内网桌面，以及 Windows 系统客户端入口。
- 本地文件与 WebDAV 加密备份，按设备查看历史，支持分项预览恢复、导入连接副本和自动备份。

操作方式与限制见 [使用说明](docs/development.md#使用说明)。内嵌 RDP 的 TLS 兼容边界见 [RDP 设计说明](docs/architecture.md#内嵌-rdp)；已记录的原生验证范围与缺口见 [验收记录](docs/development.md#已有验收记录与缺口)，不能据此推断所有目标平台均已验收。

## 界面预览

以下截图来自 [演示模式](docs/development.md#设置与演示模式)。

连接中心

![连接中心，支持分组、协议筛选与延迟探测](docs/images/screenshots/connection-center.png)

SSH 工作区

![SSH 终端、远端文件树与 Linux 监控](docs/images/screenshots/ssh-workspace.png)

远端文件编辑

![远端文件编辑器，支持编码、换行符与代码缩略图](docs/images/screenshots/remote-file-editor.png)

## 运行与开发

准备 Go、Node 和 pnpm。工具链及依赖版本以 [go.mod](go.mod)、[frontend/package.json](frontend/package.json) 和锁文件为准，原生桌面还需要对应平台的构建工具与 WebView。

首次运行按 [开发说明](docs/development.md#首次运行) 安装依赖及项目内 Wails CLI，然后在仓库根目录启动：

```sh
wails3 dev
```

平台前提、绑定生成、检查命令和真实服务测试配置见 [开发说明](docs/development.md)，生产构建与安装包入口见 [构建与本地打包](docs/development.md#构建与本地打包)。

## 项目结构与文档

| 入口 | 职责 |
| --- | --- |
| `main.go`、`assets.go` | 程序入口、资源嵌入与构建信息 |
| `internal/app/` | 桌面启动、服务绑定、工作区与跨模块生命周期协调 |
| `internal/` 其余子包 | SSH、远端文件、监控、RDP、存储和备份 |
| `frontend/src/` | React 工作区、终端、编辑器与设置界面 |
| `frontend/bindings/` | 从 Go 生成的前端接口，避免手工维护重复定义 |
| `Taskfile.yml`、`build/` | 开发、原生构建与打包资源 |
| `.github/workflows/`、`scripts/` | 持续集成、版本同步与发布 |
| [架构约束与设计理由](docs/architecture.md) | 设计意图、职责边界、数据与安全契约，附代码定位入口 |
| [开发说明](docs/development.md) | 环境、运行、使用、验证与打包 |
| [Agent 开发约定](AGENTS.md) | 工作边界、事实来源和语义变更后的文档影响分析 |

## 开源许可

项目采用 [Apache License 2.0](LICENSE)。依赖许可原文位于 [build/licenses](build/licenses)，来源、核对范围与发行前待办见 [第三方依赖声明](THIRD_PARTY_NOTICES.md)。
