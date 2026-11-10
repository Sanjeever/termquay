# TermQuay

[English](README.md) · [贡献指南](CONTRIBUTING.md)

TermQuay 是使用 Go、Wails v3 和 React 构建的开源远程连接工作台，将 SSH、本地终端、远程文件编辑、Linux 监控和内嵌 RDP 放在统一桌面工作区，支持连接分组、本地加密文件与 WebDAV 快照备份。连接数量不设置商业限制。

支持 macOS、Windows 和 Linux。从 [GitHub Releases](https://github.com/Sanjeever/termquay/releases) 下载对应平台的压缩包；运行前提见 [环境说明](docs/development.zh-CN.md#环境与定义入口)，已记录的验证范围与缺口见 [验收记录](docs/development.zh-CN.md#已有验收记录与缺口)。

## 界面语言

在“设置 → 外观 → 语言”选择跟随系统、简体中文或 English。语言资源随应用离线分发，解锁本机数据前即可生效。切换语言保留活动工作区、连接、传输与编辑草稿。

## 当前能力

- [连接管理](docs/development.zh-CN.md#连接与工作区)：分组与筛选、配置导入、操作手册、加密凭据与主密码保护。
- [SSH 与本地终端](docs/development.zh-CN.md#ssh-工作区与本地终端)：多种认证、跳板与代理、端口转发、双窗格、重连与连接诊断。
- [文件管理与传输](docs/development.zh-CN.md#远端文件与传输)：搜索、批量传输、显式续传、目录同步、文件对比与跨主机复制。
- [文件编辑](docs/development.zh-CN.md#文件编辑)：多编码、补全、冲突合并、版本历史与配置验证；[文件预览](docs/development.zh-CN.md#文件预览) 支持 Markdown 与常见图片。
- [终端工具与多主机操作](docs/development.zh-CN.md#终端工具与命令片段)：片段与补全、tmux、录制回放、后台执行、巡检与结果比较。
- [Linux 监控与日志](docs/development.zh-CN.md#linux-监控与日志查看)：资源趋势、进程与服务、端口、多来源日志与排障快照。
- [Docker 容器](docs/development.zh-CN.md#docker-containers)：“工具 → Docker”打开独立标签，通过 SSH 查看容器状态、资源、日志、终端、挂载和端口，确认后启动、停止或重启。
- [内置 AI 助手](docs/development.zh-CN.md#内置-ai-助手)：SSH 工作区对话、终端选文引用、按远端能力查询与执行脚本、命令批准及本机加密历史。
- [远程桌面](docs/development.zh-CN.md#远程桌面)：内嵌 RDP、SSH 网关与 Windows 系统客户端。
- [本机工作环境](docs/development.zh-CN.md#本地草稿与布局恢复)：命名工作集、布局与草稿恢复，以及[外观和快捷键](docs/development.zh-CN.md#设置与演示模式)。
- [加密备份](docs/development.zh-CN.md#备份与恢复)：本地文件与 WebDAV 快照、预览恢复与配置迁移。

操作方式与限制见 [使用说明](docs/development.zh-CN.md#使用说明)，内嵌 RDP 的 TLS 兼容边界见 [RDP 设计说明](docs/architecture.zh-CN.md#内嵌-rdp)。

## CLI 与 Agent Skill

同一程序无参数启动桌面，`termquay --help` 查看 CLI 帮助。先在桌面“设置 → 本机 CLI”启用访问并解锁，再用精确 SSH 工作区 ID 查询远端或执行命令。CLI 可修改远端，支持命令、平台程序路径与取消限制见 [本机 CLI](docs/development.zh-CN.md#本机-cli)。

安装供外部 AI Agent 使用的 [termquay skill](skills/termquay/SKILL.md)：

```sh
npx skills add Sanjeever/termquay --skill termquay -g
```

项目级安装去掉 `-g`。指定 `--skill termquay`，避免同时安装仓库开发技能。Skill 不安装 TermQuay；Node 仅供 skill 安装使用。

## 界面预览

以下截图使用中文 UI，在浏览器 [演示模式](docs/development.zh-CN.md#设置与演示模式) 中截取。

连接中心

![连接中心，支持分组、协议筛选与延迟探测](docs/images/screenshots/connection-center.png)

SSH 工作区

![SSH 终端、远端文件树与 Linux 监控](docs/images/screenshots/ssh-workspace.png)

远端文件编辑

![远端文件编辑器，支持编码、换行符与代码缩略图](docs/images/screenshots/remote-file-editor.png)

## 运行与开发

准备 Go、Node 和 pnpm。工具链及依赖版本以 [go.mod](go.mod)、[frontend/package.json](frontend/package.json) 和锁文件为准，原生桌面还需要对应平台的构建工具与 WebView。

首次运行按 [开发说明](docs/development.zh-CN.md#首次运行) 准备依赖，然后在仓库根目录启动：

```sh
pnpm dev
```

项目内 Wails CLI、构建、打包、绑定生成和检查入口统一见 [开发命令](docs/development.md#development-commands)，平台前提与真实服务测试配置见 [开发说明](docs/development.zh-CN.md)。

## 项目结构与文档

实现与验证入口统一见架构文档的 [代码导航](docs/architecture.md#code-navigation)。[架构说明](docs/architecture.zh-CN.md) 保留设计前提与取舍，[开发说明](docs/development.zh-CN.md) 提供运行、使用和验证入口，[AGENTS.md](AGENTS.md) 规定贡献边界与文档同步要求。

## 开源许可

项目采用 [Apache License 2.0](LICENSE)。依赖许可原文位于 [build/licenses](build/licenses)，来源、核对范围与发行前待办见 [第三方依赖声明](THIRD_PARTY_NOTICES.md)。
