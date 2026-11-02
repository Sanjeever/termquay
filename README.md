# TermQuay · 栈桥

TermQuay 是使用 Go、Wails v3 和 React 构建的开源远程连接工作台，将 SSH 终端、远程文件编辑、Linux 监控和内嵌 RDP 放在统一桌面工作区，支持连接分组与加密 WebDAV 备份。连接数量不设置商业限制。

项目处于开发阶段，目标平台为 macOS、Windows 和 Linux，尚未提供稳定安装包。代码接入与真实桌面验收分开记录，具体进度和平台验证范围见 [handoff.md](handoff.md)。

## 当前能力

- 连接与分组持久化、搜索和协议筛选；凭据字段加密，系统密钥库保护本地主密钥，密钥库不可用时可选择会话存储。
- SSH 密码、私钥及加密私钥认证，主机指纹确认，多工作区与独立 PTY，终端尺寸同步和有界输出消费确认。
- SSH 三栏工作区，包含 SFTP 浏览与基本操作、CodeMirror 文件编辑、草稿与保存冲突检测、按需 Linux 监控，以及上传下载任务、进度和取消。
- 手动创建 WebDAV 加密快照，选择是否携带凭据，预览后确认跨设备恢复。
- IronRDP WASM 工作区和 Go RDCleanPath 桥接已接入，具备证书校验与桌面控制入口；真实 RDP 画面、输入和多会话仍待验收。

SSH Agent、键盘交互认证、分组整理、自动备份、跳板机、端口转发和格式导入等尚有实施工作，见 [后续阶段与验收](handoff.md#后续阶段与验收)。

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
| [实施状态与验收](handoff.md) | 阶段进度、历史验证证据和未完成事项 |
| [Agent 开发约定](AGENTS.md) | 工作边界、事实来源和语义变更后的文档影响分析 |

## 开源许可

项目采用 [Apache License 2.0](LICENSE)。依赖许可原文位于 [build/licenses](build/licenses)，来源与发行前待办见 [第三方依赖声明](THIRD_PARTY_NOTICES.md)。正式发行审计尚未完成。
