# Handoff: 对齐 xterminal 工作台体验、文件自动换行与 RDP 修复

## 1. 任务摘要

实现已确认的三项工作：远端文件默认软换行；定位并修复真实 RDP 连接失败，完善失败与重试流程；将界面调整为“连接中心 + 连接工作区”，对齐 xterminal 核心操作方式。完成验证、文档同步，并及时形成可审阅的中文小提交。

本文交接待执行任务，不代表功能已实现或真实连接已验收。

## 2. 背景

用户在开发环境实际操作后反馈界面混乱、操作不顺手。源码检查确认：

- 连接目录与远端文件共用左侧内容栏，切换用途时替换整个侧栏。
- 选中连接后插入整行“连接”按钮，后续连接条目随之移动。
- 顶部混合全局操作和当前会话操作，区域职责需要整理。
- CodeMirror 未启用 `EditorView.lineWrapping`，长行依赖横向滚动。
- RDP 连接失败后移除工作区，缺少原位重试和编辑连接入口。
- RDP 初始化 Promise 为模块级缓存，首次失败会保留被拒绝的 Promise，后续尝试无法重新初始化。

已有检查确认用户提供的 SSH/RDP 目标端口曾 TCP 可达，未验证这些目标的 SSH 登录、RDP 认证、桌面画面与输入。RDP 根因尚未确认，不得直接归因于初始化缓存、账户格式、证书或来源白名单。

设计依据为 [xterminal 界面导览](https://docs.xterminal.cn/getting-started/interface-overview/)、[文件浏览器](https://docs.xterminal.cn/sftp/browser/) 和 [远程编辑](https://docs.xterminal.cn/sftp/remote-edit/)。以文档与官方截图中的核心布局、操作路径为参考，不将完整功能列表转化为本轮需求。

## 3. 目标与范围

### 目标

- 默认软换行，长行随编辑区域折行；显示折行不修改文件内容。
- 用真实错误定位 RDP 失败环节，修复到能连接测试目标并完成桌面交互验收。
- RDP 失败或断开后保留可操作页面，提供重试、编辑连接和可展开技术详情，释放旧连接资源。
- 连接中心作为固定、可返回的外层标签入口，集中管理分组、搜索、SSH/RDP 筛选和连接操作。
- SSH 工作区采用左侧远端文件、中央终端/文件编辑、右侧可收起监控。面板可调整，中央优先保留操作空间。
- 保留外层连接工作区与 SSH 内层终端/文件两级标签，各连接保留自己的目录、滚动、终端和草稿状态。
- 连接列表行高稳定；单击选择、双击或 Enter 连接；固定工具栏与右键菜单提供管理操作，保留键盘入口。
- 全局搜索与设置保持固定入口，会话操作靠近当前会话；底部保留状态和按需展开的传输详情。
- 统一紧凑工具界面的间距、对齐、选中态、焦点和控件样式，实际复核原生窗口。

### 不包含

- 完整复制 xterminal 功能，包括 AI、VNC、Telnet、隧道、Shell Integration、账号与云服务。
- 应用图标重做、营销区域、引导页、装饰性说明、成功通知弹窗和新主题体系。
- 替换 CodeMirror 为 Monaco、扩展为 IDE，或为软换行新增配置系统。
- 重写协议栈、引入外部 CLI 代办业务、无依据更换 IronRDP 或升级依赖。
- 修改备份恢复、WebDAV、数据库或快照格式，清空用户数据。
- 修改远端系统、服务、认证策略或安装远端依赖；推送、Release、签名与发布。

## 4. 技术上下文

- 单机 Go/Wails v3 桌面应用；Go 管理网络、认证、会话、传输、采集、存储和备份，React/TypeScript 管理视图与编辑草稿。
- 沿用 Vite、Tailwind CSS、HeroUI、pnpm、Go Modules、xterm.js、CodeMirror、IronRDP。版本以 `go.mod`、`frontend/package.json`、锁文件和 Taskfile 为准。
- SQLite 有 `groups`、`connections`、`credentials`、`settings` 表。`Connection` 包含稳定 ID、协议、主机、端口、用户名、可选域和凭据引用。本轮默认无数据库变更。
- Wails 绑定承接控制操作，事件传递低频状态，Streams 传递终端数据。Go 签名或模型变化后生成绑定，禁止手工修补派生产物。
- SSHWorkspace 持有 owner Stream，卸载会关闭整个工作区。切换连接中心、设置、面板或标签不能因此卸载活动会话。
- RDP 使用 IronRDP WASM + Go RDCleanPath/TLS 桥接。保留回环监听、精确来源、短期一次性授权、具体目标绑定、TLS/NLA 和证书指纹校验。
- RDP 密码仅用于创建认证链路，不进入 React 全局状态、localStorage、日志或快照；已保存 SSH 秘密继续留在 Go。
- 原架构文档将“连接目录与远端文件共用侧栏”写为设计。本轮已授权调整为连接中心入口与工作区文件面板，实施时同步修改该设计和理由；其他安全、数据和生命周期契约继续有效。

## 5. 当前实现分析

| 文件 | 当前实现与关注点 |
| --- | --- |
| `frontend/src/App.tsx` | 工作区、连接尝试、共享侧栏、全局监控开关和传输入口；RDP 工作区当前使用 grant ID；接入连接中心与失败页面 |
| `frontend/src/components/layout/Workbench.tsx` | `SidebarMode` 区分 connections/files，共用侧栏与导航；调整布局职责 |
| `frontend/src/components/layout/WorkspaceTabs.tsx` | 外层标签、切换和关闭；增加固定连接中心入口，保留键盘导航 |
| `frontend/src/features/connections/ConnectionSidebar.tsx` | 分组、搜索、协议下拉、列表；选中时插入 selected-connect 按钮；更多菜单尚无右键入口 |
| `frontend/src/features/connections/ConnectionDialog.tsx` | 新建、编辑、快速连接及凭据保留语义；复用为编辑和重新输入认证材料入口 |
| `frontend/src/features/connections/useConnectionAttempt.ts` | SSH/RDP、身份确认、取消和资源所有权；RDP 异常时移除工作区并清理 grant |
| `frontend/src/features/connections/HostTrustDialog.tsx` | 首次身份确认，保留指纹确认与取消行为 |
| `frontend/src/features/files/SSHWorkspace.tsx` | 终端、目录、草稿、关闭协调；文件浏览经 portal 接入共享侧栏；调整文件面板归属 |
| `frontend/src/features/files/FileBrowser.tsx` | 目录、选择、路径与操作；保留每个连接的目录与滚动状态 |
| `frontend/src/features/files/CodeEditor.tsx` | 按路径创建 CodeMirror，支持内容同步、Mod-s 和可见时测量；缺少软换行 |
| `frontend/src/features/terminal/TerminalView.tsx` | xterm、焦点、尺寸、输入与消费确认；布局不能破坏背压或重建 PTY |
| `frontend/src/features/monitor/MonitorPanel.tsx` | 宽度、订阅、可见性与采样状态；隐藏工作区不继续采集 |
| `frontend/src/features/rdp/RDPView.tsx` | 初始化、连接、状态、工具栏与事件；检查失败缓存、重试和异步关闭 |
| `rdp.go` | 探测、信任、保存凭据启动、grant 和关闭；来源白名单含固定开发端口 |
| `internal/rdp/bridge.go`、`bridge_test.go` | RDCleanPath、TLS/NLA、身份和转发；现有测试用模拟 TLS 目标，不能证明 Windows 登录通过 |
| `frontend/src/features/files/TransferPanel.tsx`、`useTransfers.ts` | 状态与详情分离，收起后任务继续，保留所有权 |
| `frontend/src/components/CommandPalette.tsx` | 搜索连接、工作区和操作；同步新入口与焦点 |
| `frontend/src/style.css`、`styles/tokens.css` | 布局、列表、标签和语义颜色；按结构变化局部调整 |
| `frontend/vite.config.ts`、`Taskfile.yml` | 开发端口和任务，核对实际来源 |
| `docs/architecture.md`、`docs/development.md`、`README.md` | 按最终语义更新设计、操作与验收事实 |

表内缩写路径以该行第一个完整路径所在目录为准。

## 6. 实现方案

### 阶段一：软换行与 RDP 修复

1. 修改 `CodeEditor.tsx` 扩展列表，启用 `EditorView.lineWrapping`。核对父级收缩约束与测量，实际需要时修改 `style.css` 或 `SSHWorkspace.tsx`。禁止插入换行符或裁切溢出内容。
2. 在原生 Wails 环境复现 RDP，按组件装载、就绪、证书探测、桥接授权、TLS/NLA、认证、桌面建立分段定位。依据 `RDPView.tsx`、`useConnectionAttempt.ts`、`rdp.go` 和桥接实际错误修复。
3. 核对 JS/组件/WASM 兼容组合、资源装载、WebView 实际 Origin 与精确白名单。开发端口与白名单分别定义，不能用通配符替代核对。
4. 修改 `RDPView.tsx`，成功初始化复用缓存；失败后允许下次显式重试重新初始化。处理就绪等待、取消、旧事件和晚到结果，避免永久等待或关闭后更新状态。
5. 修改 `App.tsx`、`useConnectionAttempt.ts` 和 `RDPView.tsx`，分离失败页面保留与资源回收。失败/断开页面显示状态、重试、编辑入口及可展开详情；失败不删除已保存连接配置。
6. 每次重试重新获取 grant，不复用一次性令牌。必要时分离稳定 UI 工作区 ID 与每次 grant ID，后端事件按当前 grant 匹配；旧尝试不得影响新会话。
7. 保存连接重试通过后端重新取得启动材料，临时连接需要时重新输入密码。不得为重试长期保留密码或自动无限重试。
8. 依据确认根因增加有维护价值的回归验证，保持证书、来源、授权、取消和关闭检查，补齐真实 Windows 验收。

### 阶段二：连接中心与工作区布局

```text
外层标签    连接中心 │ SSH 连接 A │ SSH 连接 B │ RDP 连接 C
连接中心    分组树   │ 连接列表
SSH 工作区  远端文件 │ 终端 / 文件编辑标签 │ 监控
RDP 工作区          │ 远程桌面
底部        状态与传输入口，传输详情按需展开
```

- 修改 `App.tsx`、`Workbench.tsx`、`WorkspaceTabs.tsx`，接入固定连接中心。关闭最后一个连接后返回连接中心；切换入口和设置保留会话、草稿和传输所有权。
- 推荐新增 `frontend/src/features/connections/ConnectionCenter.tsx` 作为完整页面，复用或迁移 `ConnectionSidebar.tsx` 的分组与操作；完成后移除失去用途的旧组件，避免两套状态与业务逻辑。
- 连接中心采用分组树与紧凑列表，提供搜索及“全部 / SSH / RDP”筛选。移除选中后新增按钮行，使用固定工具栏、行菜单、鼠标右键与可访问的菜单按钮。
- 保留稳定连接 ID、双击/Enter 定位已有工作区、显式另开工作区语义。保存、保存并连接和临时连接沿用现有数据接口。
- 修改 `SSHWorkspace.tsx`、`FileBrowser.tsx` 和布局容器，使文件面板属于当前连接，消除与连接目录互相替换的模式。保留目录、选择、滚动、宽度与展开偏好。
- 监控操作靠近当前 SSH，按实际可见性订阅；保留调整、收起与尺寸偏好。窄窗口优先收起辅助面板，提供恢复入口。
- 同步命令搜索及调用处，支持进入连接中心、切换工作区和操作当前会话。
- 两级标签通过高度和样式区分层级。切换入口不重建 SSH/RDP，不重放输入或远端命令。

### 阶段三：视觉整理与完整流程复核

- 结构稳定后调整 `style.css`，必要时局部调整 `styles/tokens.css`。统一行高、间距、对齐、选中与焦点，减少重复入口和多余边界，沿用当前深色工具风格与系统字体。
- 会话工具按协议展示，错误保留在操作位置，技术细节按需展开；关键状态有文字，图标保留可访问名称。
- 验证连接、终端、编辑、保存、切换服务器、传输、监控及 RDP 重试的完整路径。
- 更新架构文档中的共用侧栏设计及调整理由，更新开发说明的操作与真实验证；README 在入口说明变化时同步。

### API、数据库和配置

- 优先复用现有 Go 接口，不预建状态管理框架、通用错误框架或重试服务。
- 确需传递 RDP 失败阶段时，在 `rdp.go`、桥接和直接调用方中最小扩展非秘密状态或事件；保留真实错误详情，不靠模糊字符串猜根因。Go 定义变化同步生成绑定和测试。
- 默认无数据库、快照格式或业务配置变更。布局偏好沿用 localStorage 命名空间，处理失效布局键时不删除业务数据或凭据。
- 仅在确认来源或装载问题需要时修改开发配置，不顺带升级依赖或放宽安全策略。

## 7. 文件影响范围

### 修改

- `frontend/src/features/files/CodeEditor.tsx`。
- `frontend/src/App.tsx`、`frontend/src/components/layout/Workbench.tsx`、`WorkspaceTabs.tsx`。
- `frontend/src/features/connections/ConnectionSidebar.tsx`、`useConnectionAttempt.ts`；按重试和编辑入口需要调整 `ConnectionDialog.tsx`。
- `frontend/src/features/files/SSHWorkspace.tsx`、`FileBrowser.tsx`，以及 `frontend/src/features/rdp/RDPView.tsx`。
- `frontend/src/style.css`；按实际需要调整 tokens、监控组件及命令搜索相关调用。
- `rdp.go`、`internal/rdp/bridge.go` 和对应测试，仅在诊断或状态表达需要时修改。
- Go 定义变化时生成 `frontend/bindings/`。
- `docs/architecture.md`、`docs/development.md`，按影响更新 `README.md`。

### 新增

- 推荐 `frontend/src/features/connections/ConnectionCenter.tsx`，基于现有职责迁移。
- 与确认的 RDP 根因和生命周期修复直接相关的回归测试，沿用现有组织。
- 默认不新增其他抽象层、测试框架、持久调试脚本或独立设计文档。

### 避免修改

无关 SSH/SFTP 协议、备份恢复、数据库 Schema、凭据加密、图标、许可证、全局工具链、远端设置和参考仓库。终端、传输和监控仅按布局、可见性、焦点及直接阻塞问题做必要修改。

## 8. 约束条件

- 开始时读取 `AGENTS.md`，检查当前分支、状态与实现。交接检查时在 `main`，业务代码无未提交改动；下一会话重新确认，保留用户修改。
- 界面、文档与提交描述使用简体中文，标识符和协议字段沿用项目命名，文本遵守 `.gitattributes` 的 LF 约定。
- 本轮前端结构调整已获授权，常规可逆选择自行推进；范围外的重要产品或协议变更再说明取舍。
- 保留端到端背压、独立 PTY、SFTP/监控隔离、有界并发与缓冲、草稿及冲突处理契约。
- 保留首次身份确认、身份变化阻断、证书有效期、TLS/NLA、精确 Origin 与一次性授权。禁止关闭校验、静默降级或自动接受新身份。
- 不声称达到未验证的平台或功能一致性，不复制外部素材。
- 未授权多 Agent 工作，不主动分派子 Agent。

### 中文小提交

- 每个可运行、可审阅、通过对应检查的完整改动及时提交，采用 `<type>(<scope>): <简短中文描述>`，遵循 Conventional Commits。
- 推荐按软换行、RDP 根因修复、RDP 失败重试、连接中心、工作区面板、视觉与适配拆分。以完整行为为边界，关联调用方、必要测试与文档随同提交，不制造不可编译中间提交，不积攒为一次大提交。
- 示例：`fix(editor): 默认启用文件软换行`、`fix(rdp): 允许桌面组件初始化失败后重试`、`feat(rdp): 保留失败工作区并提供重连入口`、`feat(connections): 将连接管理移入固定连接中心`。
- 根因提交按实际问题命名，不将猜测写成事实；UI 行为变化不使用仅表示格式调整的 `style` 类型。
- 提交前检查 diff、敏感内容、文档影响和暂存清单，显式暂存本任务文件，避免 `git add .` 混入用户文件。
- 授权包含本地小提交，不推送、不发布、不改写用户提交；交付列出 commit ID、成果、检查和缺口。

### 真实连接与凭据

| 用途 | 目标 | 用户名 | 验证边界 |
| --- | --- | --- | --- |
| SSH | `192.168.10.165:22` | `root` | 先只读识别；文件验证限本次 `/tmp/termquay-*` 目录并清理 |
| RDP | `192.168.10.166:3389` | `sqyl` | 验证应用链路、认证、画面、输入、断开和重连，不修改远端策略 |

密码不写入本文。独立会话不能假定继承此前凭据；优先使用安全配置的 MCP/会话凭据，仅检查必要项是否存在。缺少时要求安全提供认证材料，同时继续独立工作；不读取 Shell 历史、其他项目配置或整份环境寻找秘密。

SSH 可按 `AGENTS.md` 使用 `sg1`，先核对身份，不假定其等同上表目标。MCP 成功不能替代应用链路验证。已有真实 SSH 测试与指纹配置见开发说明。本轮不要求 WebDAV 测试，不使用此前 WebDAV 凭据执行额外操作。

## 9. 验收标准

### 文件编辑

- [ ] 长中文行、URL、无空格字符串随区域软换行，无内容裁切或阅读所需的横向滚动。
- [ ] 软换行不插入换行符、不制造未保存状态、不改变文档内容。
- [ ] 拖动侧栏、打开监控、切换文件后布局正确，光标、选择、查找、撤销和 Mod-s 正常。
- [ ] 保存、保存期间继续编辑、冲突保留草稿及关闭确认无回归。

### RDP

- [ ] 给出可复现错误与失败阶段，修复依据来自真实证据。
- [ ] 真实 Windows 目标完成认证并显示桌面，验证键盘、焦点、尺寸、断开和重连。
- [ ] 初始化失败可显式重试，失败页面保留非秘密上下文，可重试和编辑。
- [ ] 重试创建新 grant；取消、快速关闭和旧事件不留下资源或状态串扰。
- [ ] 错误凭据能明确失败且释放资源，不删除保存配置，不为重试长期缓存临时密码。
- [ ] 证书、Origin、一次性授权、TLS/NLA 及安全测试继续有效。
- [ ] 验证默认关闭的文本剪贴板、启用后的行为及多会话隔离；缺少环境的项明确保留缺口。

### 工作台

- [ ] 固定连接中心可返回，分组、搜索、筛选、新建、编辑、删除和快速连接可用。
- [ ] 选择连接不改变行高；双击/Enter、定位已有工作区、另开工作区、右键和键盘操作正常。
- [ ] 文件、终端/编辑、监控职责明确，各连接目录、滚动和草稿保留。
- [ ] 切换入口、设置和标签不重建会话或重放输入；关闭工作区处理草稿、资源与所属传输。
- [ ] 面板调整、收起、专注模式和恢复入口正常；监控跟随实际可见性，传输详情收起后任务继续。
- [ ] 检查 900×600、1280×820、1366×768、1440×900 等窗口；区分原生实际尺寸与浏览器模拟，无整体横向溢出或重要操作遮挡。
- [ ] 两级标签、工具栏、焦点与选中态清晰；在具备环境中复核原生中文输入与缩放，无多余说明或成功弹窗。

### 检查、文档与提交

- [ ] 前端修改运行 `pnpm --dir frontend check`、`pnpm --dir frontend build`。
- [ ] 后端先跑相关最小测试，如 `go test ./internal/rdp`；根服务变化覆盖相应根包测试，必要时扩展范围。
- [ ] `-race` 按 C 编译器与 race 工具链可用性运行；不能执行时说明原因，普通测试不代替竞态检查。
- [ ] Go 定义变化后通过项目 CLI 运行 `wails3 generate bindings -ts -i`，不手改绑定。
- [ ] 保留有维护价值的回归验证，不为静态样式引入测试框架；类型检查和构建不冒充交互验收。
- [ ] 按最终 diff 同步设计、操作、验证记录，区分单元测试、替身、真实 SSH/RDP 与原生 WebView。
- [ ] 及时形成中文小提交，报告提交与检查；未验证项目不标记通过。

## 10. Agent 注意事项

- 先完成阶段一，再推进连接中心与布局，最后统一视觉与复核完整路径；常规步骤不重复索取授权。
- 本文替换上一轮已实施交接。代码已有连接弹窗、命令搜索与正式图标，不重做旧任务或采用旧基线。
- 保留失败页面不能保留废弃 grant，切换连接中心不能卸载 SSH owner；界面状态与资源所有权分别核对。
- RDP 的 closed、ready、组件生命周期与模块级初始化一起检查；重连不沿用旧关闭标志或已结束的就绪 Promise。
- `useConnectionAttempt` 当前共享 busy/error；保留失败页后，使状态归属正确尝试和工作区，避免串扰，采用最小调整。
- “端口可达”“WASM 装载”“模拟 TLS 回环”“交叉编译”均不能报告成真实 RDP 或原生桌面通过。
- 工具、原生依赖、绑定和安全测试入口见开发说明，以当前代码与实际输出为准，不复制旧环境结论。
- 真实验证受凭据或环境阻塞时完成独立实现与检查，明确剩余验证和原因，不能宣称 RDP 已修复到可用。
- 达到范围内验收标准后停止，交付成果、中文 commit、验证和必要限制。
