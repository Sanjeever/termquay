# Handoff: TermQuay 内置 AI 工作区助手

## 1. 任务摘要

为 TermQuay 增加可选的内置 AI 助手。全应用使用一份模型配置，支持 Chat Completions、Messages、Responses 三种端点。在 SSH 工作区右侧与 Agent 对话，自动执行结构化查询；Shell 命令默认逐次确认，可在设置中关闭确认。支持将终端选文加入对话，以及本机加密历史、新对话和删除历史。

本文件用于下一次独立实现会话。本次交接未实现 AI 功能。实现时按可审阅、可验证的完整改动及时做小步本地 commit，不能积累到最后统一提交。

## 2. 背景

TermQuay 是单机 Go/Wails 桌面应用，已有 SSH 会话所有者、独立远端命令执行、结构化诊断查询、加密设置和本机 CLI。目前没有内置模型配置、Agent 运行循环或 AI 对话界面。

内置 Agent 复用 CLI 背后的 Go 操作能力，不启动本机 Shell 或 TermQuay CLI 子进程。外部 CLI 继续使用原有 IPC 和授权开关。开启 AI 不打开、不关闭或绕过外部 CLI 的授权开关；两种入口可独立启停。

交接前核对的基线为 `main`，HEAD `9ebafe5`，功能实现尚未开始。新会话必须重新检查当前分支和工作区，保留其他改动。

## 3. 目标与范围

### 目标

- 设置增加 AI 分类，默认关闭。全应用始终一份配置，不做多服务商列表或模型切换器。
- 字段包含启用开关、接口类型、端点地址、模型名称、API Key，以及默认开启的「执行 Shell 命令前确认」。
- 保存完整配置后可用，不强制先测试；提供测试连接，分别检查普通回复与工具调用。
- SSH 工作区右侧提供类似 Cursor 的面板，支持收起和调宽，与现有右侧监控区域切换显示。
- 每个工作区维护独立当前对话；支持流式回复、工具调用与结果、Shell 批准/拒绝、停止、新对话、历史和删除。
- 终端选文可通过右键「加入 AI 对话」。先进入待发送引用区域，支持查看和移除，用户发送后才请求模型。
- Agent 绑定当前真实 SSH 实例，使用下文确定的 10 个工具。
- 对话按连接归档，本机加密保存；同一连接打开多个工作区时，各自当前对话独立。
- 完成生命周期、资源限制、协议适配、数据保护、测试及必要文档同步。

### 不包含

- 多份模型配置、多 Agent 协作、跨工作区或多主机操作。
- RDP、本地终端、容器交互终端中的 AI 入口。容器查询工具仍可操作当前 SSH 主机上的容器。
- 自动建立 SSH 连接、自动接受主机身份、自动提权、代填 sudo 密码或控制交互式安装向导。
- 通用 MCP/插件系统、账号服务、云端控制面、知识库、联网搜索或供应商内置远程执行工具。
- 自动采集终端画面、滚动历史、键盘输入或用户未主动加入的终端文本。
- 恢复并继续旧运行、自动重放命令、把旧批准带到新连接。
- AI 配置与历史的常规备份迁移、版本 bump、推送、Release、签名分发及无关重构。

## 4. 技术上下文

- 技术栈及版本以 `go.mod`、`frontend/package.json`、锁文件、Taskfile 为准。现有 Go/Wails v3、React、TypeScript、Vite、Tailwind CSS、HeroUI、pnpm 和 SQLite 保持不变。
- Go 持有凭据、网络、Agent 轮次、批准状态和历史；React 管理视图、输入草稿与待发送引用。关闭或卸载面板不能成为运行所有者销毁条件。
- `workspaceOwner` 位于 `internal/app/app.go`，包含真实连接、目标、生命周期和保存连接 ID。
- 前端 `Workspace.id` 是外层标签标识，`sessionID` 是真实 SSH 工作区标识；重连可以保留前者但替换后者。工具执行使用后者，还要核对所属 owner 实例。
- `RunRemoteCommand` 使用独立 SSH session 执行 `sh -s`，无 PTY，不继承用户交互终端的 cwd、环境变量或别名。Agent 需要工作目录时在脚本中显式 `cd`。
- 现有命令层已有全局与每连接资源限制、超时、stdout/stderr 截断、未知退出状态；继续复用，禁止用关闭共享 SSH 连接取消单条命令。
- SQLite 当前 `PRAGMA user_version = 1`，包含 `groups`、`connections`、`credentials`、`settings`。凭据使用 AEAD；设置已有加密与事务更新方法。没有 AI 表或迁移框架。
- 数据库最多一个打开连接。分页读取及时关闭 rows；事务中不要回调另一条需要同一数据库连接的查询。
- 持久存储支持系统密钥库和主密码；会话存储退出后不保证历史保留，不能为了 AI 偷偷建立额外持久目录。
- API 协议实现前核对厂商官方文档，尤其流式工具参数、工具结果关联、续接内容和错误语义。三种协议适配同一个应用侧 Agent 循环，不强制用户部署代理。

## 5. 当前实现分析

| 文件 | 说明 |
|---|---|
| `AGENTS.md` | 项目边界、文档一致性、远端操作与本地提交约定 |
| `docs/architecture.md` | 生命周期、背压、存储、CLI 和单机架构契约 |
| `docs/development.md` | 绑定生成、检查命令、真实 SSH 测试和使用入口 |
| `internal/app/app.go` | `AppService`、`workspaceOwner`、`CloseWorkspace`、`ServiceShutdown` |
| `internal/app/terminal_sessions.go` | 工作区/终端所有权和会话关闭路径 |
| `internal/app/application_lock.go` | 手动、空闲及系统锁定；所有锁定路径都须覆盖 AI |
| `internal/app/commands.go` | `RunRemoteCommand`，独立远端命令执行和全局槽位 |
| `internal/ssh/command.go` | `RunCommand`、`CommandResult`，底层未完成请求限制、取消及输出边界 |
| `internal/app/cli.go` | 外部 CLI 授权与操作分发；不能直接作为内置 Agent 总入口 |
| `internal/app/cli_queries.go` | 文件、服务、端口、容器查询对应的现有 Go 服务调用 |
| `internal/app/cli_settings.go` | 独立的 `cli_access` 设置与锁定检查 |
| `internal/cli/cli.go`、`internal/localapi/protocol.go` | 外部 CLI 参数和 IPC 协议，第一版不增加 AI 子命令 |
| `internal/app/command_runs.go`、`internal/app/command_run_history.go` | 后端运行所有权、快照及加密记录的参考模式；不把 AI 塞进多主机任务 |
| `internal/store/store.go` | SQLite 初始化、数据库版本检查、现有表和 AEAD 状态 |
| `internal/store/vault.go`、`internal/store/secret_settings.go` | 加密设置、AAD 和事务更新入口 |
| `internal/app/portable_settings.go`、`internal/app/portable_workflows.go` | 备份白名单与恢复，AI 数据保持排除 |
| `frontend/src/features/settings/SettingsView.tsx` | 设置导航与按需加载分类 |
| `frontend/src/features/settings/CLISettings.tsx` | 简单设置页面和错误展示参考 |
| `frontend/src/features/files/SSHWorkspace.tsx` | `id/sessionID`、终端实例、右侧监控、宽度和窄窗口逻辑 |
| `frontend/src/features/terminal/TerminalView.tsx` | xterm 实例、`getSelection()`、终端操作菜单；当前未提供 AI 选文入口 |
| `frontend/src/App.tsx` | 工作区创建、重连替换 `sessionID`、设置和隐藏工作区生命周期 |
| `frontend/src/components/Popover.tsx`、`frontend/src/components/layout/ResizeHandle.tsx` | 复用现有弹出菜单及拖动控件 |
| `frontend/src/style.css`、`frontend/src/styles/sessions.css` | 样式入口与工作区布局 |
| `internal/app/startup.go` | Wails 服务、事件和 Stream 注册 |
| `frontend/bindings/` | Go 派生绑定，使用 Wails 命令生成 |
| `frontend/package.json`、`scripts/test.mjs`、`build/Taskfile.yml` | 前端验证、测试发现和绑定/构建入口 |

## 6. 实现方案

### 6.1 模型配置与请求适配

- 新增 `internal/app/ai_settings.go` 管理唯一配置、启停、测试和脱敏读取。配置通过现有加密设置保存，例如 `ai_config`，不向前端回显已有 API Key；更新时明确区分保留、替换和清除。
- 建议将端点地址定义为完整请求 URL，对三种类型给出对应示例路径，避免自动猜测或重复拼接 `/v1`。协议类型由用户选择，不自动降级或切换。
- 新增 `internal/ai/types.go` 定义本任务必需的消息、工具调用、流事件和用量数据；新增 `client.go`、`chat_completions.go`、`messages.go`、`responses.go` 实现实际适配。接口与文件可按最终依赖调整，不预建通用框架。
- 统一支持文本流、工具调用参数累积、工具结果续接、错误和取消；保留各协议继续对话所需的数据。工具调用片段完整并验证后才能执行。
- 优先使用合适的成熟 SDK/流处理依赖，评估三种协议覆盖和资源开销；新增直接依赖时同步锁文件及第三方许可材料。不要为统一 API 引入独立服务或大型 Agent 框架。
- 测试连接只发送简单测试内容和本机无副作用的测试工具，不携带真实工作区、SSH 凭据或历史。分别报告回复与工具调用是否可用，不执行服务器操作。普通回复可用但工具调用不可用时明确展示，不能伪造 Agent 成功。
- 关闭 AI 取消进行中的轮次，保留配置/历史；启用 AI 不改变 `cli_access`。修改连接配置后，后续请求必须使用明确配置快照，不能在一个进行中的轮次里静默将上下文切换发送到另一个端点。

### 6.2 固定的 10 个工具

新增 `internal/app/ai_tools.go`，复用现有 Go 服务和校验，保持查询实际行为及输出边界。外部 CLI 处理器带独立授权，不直接调用 `handleCLI`，也不为了复用而重构整套 CLI。

| 工具名 | 现有能力入口 | 批准 |
|---|---|---|
| `file_list` | `BrowseTransferDirectory` | 自动 |
| `file_read` | `ReadRemoteFileEncoded` | 自动 |
| `service_list` | `ListLinuxServices` | 自动 |
| `service_inspect` | `ReadLinuxServiceDetails` | 自动 |
| `service_logs` | `ReadLinuxServiceLog` | 自动 |
| `port_list` | `ListLinuxPorts` | 自动 |
| `container_list` | `ListContainers` | 自动 |
| `container_inspect` | `InspectContainer` | 自动 |
| `container_logs` | `ReadContainerLogs` | 自动 |
| `exec` | `RunRemoteCommand` | 默认逐次确认，设置可关闭 |

- 模型上下文包含真实 workspace ID 和必要目标信息，但工具参数不暴露可自由选择的 workspace ID。后端从运行绑定注入目标，并在执行时复核 owner。
- 查询权限按工具类型区分。`exec` 中的 `ls`、`cat` 等脚本仍走 Shell 确认；不建立命令关键词白名单或所谓自动危险命令分类。
- 文件写入、搜索、软件安装、服务/容器启停等第一版通过 `exec` 完成，不增加专门写入工具。
- 不暴露连接枚举、跨工作区、全局任务历史或本机文件读取工具。
- 当前 SSH 身份就是执行身份；不代填凭据，不创建交互 PTY。非交互 sudo 若服务器已有授权仍由实际命令结果决定，不能自动提权或重试。

### 6.3 Agent 运行与批准

- 新增 `internal/app/ai.go` 持有轮次与应用接口，新增 `internal/app/ai_runs.go` 实现循环、取消和批准状态。后端任务独立于发起请求/视图生命周期，每个工作区同时一个运行轮次，全局并发有界。
- 建议跨语言接口包含 `GetAISettings`、`SaveAISettings`、`TestAIConnection`、`CreateAIConversation`、`ListAIConversations`、`GetAIConversation`、`StartAIRun`、`GetAIRun`、`ApproveAIToolCall`、`RejectAIToolCall`、`StopAIRun`、`DeleteAIConversation`。名称可依项目命名细化，类型定义在 Go 后生成绑定。
- 批准在后端等待。待批准项固定绑定轮次、conversation、owner 实例、tool call ID、完整脚本和超时；批准一次只消费一次。旧 UI、重复批准、参数变化和重连后批准均不得误执行。
- 拒绝作为工具未执行的结果返回给模型，禁止无依据自动重试同一脚本。Shell 批准不能替代应用锁和真实连接检查。
- 新对话不继承旧上下文。一个工作区已有运行时，先停止旧轮次再创建/切换到可执行的新对话；删除运行中的对话先取消并结束写入，防止删除后后台重新创建消息。
- 用户停止、关闭 AI、断开/关闭工作区、应用锁定和退出时，取消当前轮次并使待批准项失效；解锁、重连、重启不自动继续。
- `CloseWorkspace` 和 `ServiceShutdown` 接入取消与等待，退出时先结束 AI 保存再关闭 store。手动、空闲、系统锁定都须覆盖，不依赖前端收到事件后才停止执行。
- 取消不能宣称远端进程已退出。保留退出码、错误、截断和远端状态未知，不自动重放。
- 文件、日志、终端引用和命令输出属于外部数据，不当作新的系统指令；服务端授权和 owner 绑定不受文本内容改变。

### 6.4 数据库存储与历史

- 新增 `internal/store/ai.go`，保存会话元数据与分条消息。建议新增 `ai_conversations`、`ai_messages`，后者按 conversation 和消息序号建立分页索引。
- 在 `internal/store/store.go` 增加事务化、可重复打开的版本迁移，数据库版本从现有 1 前进；未知未来版本仍拒绝打开。旧分组、连接、凭据和设置必须保留，备份格式和应用版本不随数据库自动改变。
- 会话包含 ID、保存连接 ID（可为空）、原目标快照、创建/更新时间和展示标题。临时连接历史保留独立身份，不把所有空 connection ID 合并。连接更改地址或用户后，继续历史时展示原目标与当前目标，不能无声把它们当同一环境。
- 消息包含角色、顺序、文本/引用、工具调用及结果和执行状态；复用现有 AEAD 和明确 AAD 命名空间加密。标题、摘要、引用、工具输出等内容不能遗漏加密。
- 元数据与消息按必要事务更新，历史分页读取、增量写入，不每次重写或解密全部历史，不每个 token 落盘。
- 历史归档可跨重启查看，但执行绑定不持久化复活。启动后未完成状态表示中断，未批准/已批准记录都不能自动再执行。
- 历史、新对话、删除提供真实持久化语义；存储失败可见，不能显示为已保存。
- 不加入 `store.Data`、便携设置白名单或常规备份。会话存储沿用现有生命周期。

### 6.5 上下文和资源边界

- 默认上下文包含服务器目标、SSH 用户、真实工作区标识、工具说明和当前对话；模型不能获得 TermQuay 保存的 SSH 密码、私钥、API Key 等认证材料。
- 用户主动发送的引用，以及 Agent 读取的文件/日志/命令结果会发到所配置的模型服务。设置保留一句必要说明，文件内容可能自带敏感信息，不能宣称自动脱敏能覆盖任意文本。
- 单条消息、引用、模型响应、工具参数/结果、上下文、单轮工具次数和网络时限均有明确上界；遵循已有命令/文件限制，超限和截断可见。具体数值由实现代码定义，不在文档维护第二份默认值。
- 本机完整历史与模型输入分开。长对话按预算保留近期完整工具往返和必要上下文，较早内容做摘要压缩，界面显示压缩状态；摘要不得代替实际工具结果、批准状态或连接检查。压缩失败明确报错，不静默丢历史。
- 大量输出保持有界并合并增量。网络流、后端持久化、前端渲染队列都不能无界增长，前端按需加载历史。
- 低频状态使用 Wails 事件，持续文本/工具增量优先使用有界 Stream。可在 `startup.go` 注册 AI Stream，新增 `internal/app/ai_stream.go`。后端快照为真身，事件/流带轮次和修订序号；隐藏视图可停止订阅，重开按快照接续，不靠无限缓存补发。
- 面板关闭不取消运行，切换标签不重新请求模型；AI 关闭时不建立模型连接或启动后台 Agent。

### 6.6 前端集成

- 新增 `frontend/src/features/settings/AISettings.tsx`，在 `SettingsView.tsx` 按需加载。展示单份配置和测试状态，错误就地呈现，不增加成功 toast。
- 新增 `frontend/src/features/ai/AIPanel.tsx`、`AIConversation.tsx`、`AIHistory.tsx`、`AIToolCall.tsx`、`useAIConversation.ts`，承担面板、消息、历史、批准与状态接续。可按实际复杂度合并，避免空壳组件。
- 在 `SSHWorkspace.tsx` 增加 AI 开关、右侧 dock 切换、宽度、待发送引用和真实 session 绑定；保留监控可见性调度及终端聚焦行为，处理窄窗口。
- 在 `TerminalView.tsx` 增加只在真实 SSH 且 AI 可用时提供的选文回调和右键入口；保留现有复制、粘贴及选择行为，增加可键盘访问的等价菜单入口。引用快照包含原终端 ID、来源工作区和选文，不因随后切换终端而改变。
- 选文加入后展开 AI 面板，用户补充问题并发送；不自动请求模型。保留 Markdown 安全渲染和链接处理，不渲染模型生成的可执行 HTML。
- 历史入口在面板内展示，提供新对话和删除；切换工作区按所属对话显示，不把对话挂在单个内层终端上。
- 新增 `frontend/src/styles/ai.css` 并从 `style.css` 导入；必要时局部修改 `sessions.css`。遵循现有紧凑界面与 ARIA，不加宣传区域、重复说明或装饰徽章。
- `App.tsx` 仅在共享设置状态/重连协调确需时局部修改。AI 布局可先沿用本机布局偏好；不为此扩大工作集或备份格式。

### 6.7 小步提交顺序

以下是可拆分的交付顺序，每项完成直接相关验证后形成小提交。协议适配和界面可按完整程度继续拆小；不要求机械对应固定提交数量。每个提交应可以审阅，测试与直接相关文档跟随对应行为提交。

1. `feat(ai): 增加模型配置与加密会话存储`：配置、迁移、分页及存储测试。
2. `feat(ai): 支持 Chat Completions 模型请求`：实际请求、流解析、工具往返和协议测试。
3. `feat(ai): 支持 Messages 模型请求`：对应适配和协议测试。
4. `feat(ai): 支持 Responses 模型请求`：对应适配和协议测试。
5. `feat(ai): 增加工作区 Agent 与命令批准`：10 个工具、运行循环、绑定、取消及生命周期测试。
6. `feat(ai): 增加设置与工作区对话面板`：生成绑定、面板、流式显示、历史和新对话。
7. `feat(ai): 支持终端选文加入对话`：引用、右键及键盘入口、工作区切换验证。
8. 对最终集成发现做必要修复，补齐真实验证记录与用户入口说明，使用准确的 `fix`/`docs` 类型提交。

不要把未实现的按钮、空工具或假的成功路径作为阶段交付。实现期间无需为常规可逆细节逐次请求批准；按照本文件推进至全部验收事项完成或明确环境阻塞。提交前检查 diff、敏感信息，显式选择本任务文件暂存，不使用 `git add .`。

## 7. 文件影响范围

### 修改

- 必需：`internal/app/app.go`、`internal/app/application_lock.go`、`internal/store/store.go`。
- 必需：`frontend/src/features/settings/SettingsView.tsx`、`frontend/src/features/files/SSHWorkspace.tsx`、`frontend/src/features/terminal/TerminalView.tsx`、`frontend/src/style.css`。
- 按需要：`internal/app/startup.go`、`frontend/src/App.tsx`、`frontend/src/styles/sessions.css`。
- 由 Go 变更生成：`frontend/bindings/` 中相关绑定。
- 文档：`README.md`、`docs/architecture.md`、`docs/development.md`；如确有契约变化再局部同步 `AGENTS.md`。
- 新增依赖时：`go.mod`、`go.sum` 或前端清单/锁文件，以及 `THIRD_PARTY_NOTICES.md`、`build/licenses/` 的必要许可材料。

### 新增

- `internal/ai/` 中协议模型和三个适配器，以及有维护价值的协议测试。
- `internal/app/ai_settings.go`、`ai.go`、`ai_runs.go`、`ai_tools.go`、`ai_stream.go`（采用 Stream 时）及对应测试。
- `internal/store/ai.go`、`ai_test.go`，现有 store 测试中补充迁移覆盖。
- `frontend/src/features/settings/AISettings.tsx`、`frontend/src/features/ai/` 下实际需要的组件、hook 和有意义的状态逻辑测试。
- `frontend/src/styles/ai.css`。

### 避免修改

- CLI 命令语义、IPC 协议版本、`cli_access` 授权和外部 CLI 对外 skill。
- SSH 认证、主机信任、RDP、传输、隧道、Docker 协议栈和多主机任务的无关实现。
- 已发布版本日志、平台版本资源、无关依赖、全局环境配置、参考仓库或用户现有修改。

## 8. 约束条件

- 遵守根目录和适用的 AGENTS.md。界面、文档、必要注释和 commit 描述使用简体中文，标识符沿用英文。
- 单机结构、已有技术栈及成熟协议库；不安装远端 Agent，不通过 CLI 子进程代办业务。
- 新增 SQL 字段及别名使用小写 snake_case。加密复用现有 AEAD 和主密钥，不自创算法或明文降级。
- 密钥、密码、文件正文和对话不能进入调试日志、Git、截图或测试快照。测试使用本机服务器和合成协议数据，不能把替身测试当真实模型接入验收。
- 提交为已授权的本地小提交，使用 Conventional Commits 中文描述；不擅自推送、发布、签名或 bump 版本。
- 真实 SSH 验证遵循 `docs/development.md` 和 `AGENTS.md` 的 sg1 约束。初始只读，需要文件写入时限本次 `/tmp/termquay-*` 并清理；不启停真实业务服务或修改系统。
- 真实模型测试需要安全提供的端点和 Key，不能假定凭据已存在，不能自行从环境或历史大范围寻找秘密。缺少时继续独立工作并记录真实验证缺口。
- 不伪造工具调用、静默切换协议、吞错重试或自动重放未知远端操作。保留失败和不支持状态。
- API 和事件类型由 Go 定义，不能手工维护两套跨语言模型或修补生成绑定。

## 9. 验收标准

### 功能和权限

- [ ] AI 默认关闭；开启并保存后可用；始终只有一份模型配置。
- [ ] 三种协议均完成真实的文本流、工具调用和结果回传；取消与错误可见。测试连接区分普通回复和工具调用，不接触真实服务器。
- [ ] API Key 加密保存且不回显旧值；保存、保留、替换、清除行为准确。
- [ ] AI 与外部 CLI 的四种开关组合分别工作，互不改动；CLI 原有回归通过。
- [ ] 10 个工具与上表一致；查询自动、`exec` 默认逐次确认，关闭确认后可连续执行。
- [ ] 批准严格对应完整脚本、超时、轮次及真实实例；重复、过期、重连后的批准不能执行。
- [ ] 模型不能越过当前工作区、读取其他工作区或通过空标识回落本机。
- [ ] 文件/日志中的指令性文本不能改变授权、工具集或操作目标。

### 交互和历史

- [ ] 右侧面板可收起调宽，与监控切换自然；终端、键盘、焦点及窄窗口仍可用。
- [ ] 终端引用先预览再发送，可移除，保留正确来源；不自动上传画面或历史。
- [ ] 对话、工具状态、命令确认、拒绝、停止、新对话、历史读取和删除完整可用。
- [ ] 同一连接多工作区的当前对话隔离；切换和隐藏保留运行，重开不会重复发模型请求。
- [ ] 历史正文、标题/摘要、引用及工具结果加密，分页和增量写入；重启可读但不恢复执行。
- [ ] 新对话和删除与运行取消协调，删除后后台不会重建历史；存储失败不能显示为成功。
- [ ] 老数据库迁移保留全部既有数据；未知未来版本拒绝；AI 数据排除常规备份；会话存储语义保持一致。
- [ ] 长对话按预算压缩并显示状态，完整本机历史保留，工具往返合法且无静默丢失。

### 生命周期和资源

- [ ] 用户停止、关闭 AI、断线、关闭工作区、所有应用锁定路径及退出均阻止后续模型/工具执行，待批准项失效。
- [ ] 解锁、重连、重启和恢复历史均不自动重放；取消与远端状态未知准确展示。
- [ ] 退出在关闭数据库前结束 AI 保存；底层命令未完成仍遵守现有资源槽位限制。
- [ ] 对话并发、网络读取、工具参数/结果、单轮次数、流缓冲、前端队列与上下文有界，截断和超限可见。
- [ ] AI 关闭时没有模型连接、Agent 轮询或历史全量预载。

### 验证和交付

- [ ] 为三种协议使用本机 HTTP 测试服务，覆盖流式分片、工具参数拼接、多轮往返、错误和取消；核对协议要求的续接数据。
- [ ] 自动化测试覆盖数据库迁移/加密/分页、目标绑定、批准竞态、锁定、取消、删除与退出，不写镜像实现的低价值测试。
- [ ] Go 类型或事件变更后运行 `wails3 generate bindings -ts -i`，使用项目现有 Wails 工具。
- [ ] 根据影响运行后端包测试、`pnpm --dir frontend test`、`pnpm --dir frontend check` 和 `pnpm --dir frontend build`。Go 可先测 `./internal/ai ./internal/store ./internal/app`，竞态工具链可用时覆盖关键并发路径；不把缺少工具链当通过。
- [ ] 原生桌面检查面板、选文、批准、隐藏恢复和工作区切换；浏览器替身与编译通过不能代替原生验收。
- [ ] 有安全配置时分别完成真实模型协议和真实 SSH 链路验证；未提供的服务/平台逐项记录未验证，不能用 mock 冒充。
- [ ] README 更新入口，架构文档更新 AI 权限/数据/生命周期契约，开发说明更新配置、操作、验证及实际缺口；检索旧名称和相关示例。
- [ ] 每个完整改动及时小步 commit，最终报告提交列表、实际验证、跳过项和限制；工作区无本任务遗漏改动，不推送或发布。

## 10. Agent 注意事项

- 第一轮读取本文件和适用 AGENTS.md 后开始实现，不重复询问已确定的模型数量、确认模式、面板位置、历史策略和工具数量。
- 重新核对当前代码，表格中的已存在文件是导航，新增文件名和 API 名是实现建议，可以局部合并，但不能缩减行为或扩大范围。
- 前端标签 ID、保存连接 ID、SSH sessionID 和内层终端 ID 各有含义；不能以标签仍存在判断连接实例仍有效。
- 附加终端不等于新的 AI 工作区。用户从任何内层终端加入选文，执行依然归属于该 SSH 工作区。
- 不把 `handleCLI` 当内置入口，否则 AI 会错误依赖外部 CLI 开关；不要为解决该问题扩大外部 IPC 权限。
- Shell 确认是后端执行门槛，不能依赖模型自觉、前端布尔值或关键字判断。关闭确认也不允许改变工作区目标。
- 每次工具结果都需保留退出码、错误和截断；不要从“命令请求发出”推断执行成功，也不要向用户终端注入后台命令。
- 模型内容安全呈现，工具参数校验与日志过滤有界；不要宣传任意文件/输出已自动脱敏。
- UI 使用 React 时应用项目提供的相关技能；设计 context 生命周期时应用 golang-context，避免让 Agent 跟随一次 Wails 请求结束或面板卸载。
- 当普通实现问题、测试失败或绑定问题可以在授权范围内解决时，自行诊断继续。只有缺失实际授权或关键产品决策时才询问。
- 常规提交随步骤进行，功能测试与文档随行为提交；最后确认所有范围完成，不以完成第一阶段代替整个任务。
