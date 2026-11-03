# TermQuay · 栈桥

TermQuay 是使用 Go、Wails v3 和 React 构建的开源远程连接工作台，将 SSH 终端、远程文件编辑、Linux 监控和内嵌 RDP 放在统一桌面工作区，支持连接分组与加密 WebDAV 备份。连接数量不设置商业限制。

项目处于开发阶段，目标平台为 macOS、Windows 和 Linux，尚未提供稳定安装包。

## 当前能力

- 连接与分组持久化、搜索、收藏、最近成功记录、协议筛选与 OpenSSH 配置预览导入；凭据字段加密，系统密钥库保护本地主密钥，密钥库不可用时可选择会话存储。
- SSH 密码、私钥及 Agent 认证，单跳跳板、本地/远端/SOCKS 转发、主机指纹审核与撤销，多工作区与独立 PTY，终端尺寸同步和有界输出消费确认。
- 固定连接中心、快速连接、标签排序与双窗格；SFTP 文件定位、CodeMirror 编辑与冲突合并、原地重连、批量上传与有界传输队列、手动单向目录同步。
- 终端查找与多行粘贴预览、可配置快捷键、命令片段、专注模式、工作布局与可选加密草稿恢复；深色/浅色/系统主题、本机字体与终端配色设置。
- 按需 Linux 监控，包含有界趋势与低频文件系统容量；缺失和过期数据不冒充实时指标。
- 手动创建 WebDAV 加密快照，选择是否携带凭据，预览后确认跨设备恢复。
- IronRDP WASM 与 Go RDCleanPath 桥接支持证书校验、桌面控制、失败保留和显式重试。Windows WebView2 已验证真实目标的画面、输入、重连与手动文本剪贴板；当前桥接使用 TLS 1.2，TLS 1.3-only 目标不支持，多会话及其他原生平台仍需验证。

SSH 支持多轮交互认证与密码、私钥或 Agent 后的 MFA。自动备份尚未实现。跨平台原生输入、真实 RDP 多会话与持续负载验收仍待完成。

## 运行与开发

准备 Go、Node 和 pnpm。工具链及依赖版本以 [go.mod](go.mod)、[frontend/package.json](frontend/package.json) 和锁文件为准，原生桌面还需要对应平台的构建工具与 WebView。

首次运行按 [开发说明](docs/development.md#首次运行) 安装依赖及项目内 Wails CLI，然后在仓库根目录启动：

```sh
wails3 dev
```

生产构建和本地打包使用 `wails3 build` 与 `wails3 task package`。平台前提、绑定生成、检查命令和真实服务测试配置见 [开发说明](docs/development.md)。连接保存、身份确认、文件编辑和恢复操作边界见其中的 [使用说明](docs/development.md#使用说明)。

## 项目结构与文档

| 入口 | 职责 |
| --- | --- |
| 根目录 Go 文件 | 桌面入口、服务绑定、工作区与跨模块生命周期协调 |
| `internal/` | SSH、远端文件、监控、RDP、存储和备份 |
| `frontend/src/` | React 工作区、终端、编辑器与设置界面 |
| `frontend/bindings/` | 从 Go 生成的前端接口，避免手工维护重复定义 |
| `Taskfile.yml`、`build/` | 开发、原生构建与打包资源 |
| [架构约束与设计理由](docs/architecture.md) | 设计意图、职责边界、数据与安全契约，附代码定位入口 |
| [开发说明](docs/development.md) | 环境、运行、使用、验证与打包 |
| [Agent 开发约定](AGENTS.md) | 工作边界、事实来源和语义变更后的文档影响分析 |

## 开源许可

项目采用 [Apache License 2.0](LICENSE)。依赖许可原文位于 [build/licenses](build/licenses)，来源与发行前待办见 [第三方依赖声明](THIRD_PARTY_NOTICES.md)。正式发行审计尚未完成。
