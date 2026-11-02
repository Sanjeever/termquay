# Handoff: TermQuay UI、UX 重设计与应用图标

## 1. 任务摘要

将 TermQuay 重设计为以终端和远程桌面为中心的桌面工作台，完成布局、连接流程、文件操作、监控、传输、设置与视觉系统重构，并制作和接入正式应用图标。

本方案已实施，保留此文档作为方案与验收依据。工作台、连接流程、文件与草稿、监控传输、设置、命令搜索及 SVG 应用图标已分步提交。当前操作见 [开发说明](docs/development.md)，已执行验证与环境缺口见其中的“重设计验收记录”。下文实现分析记录实施前基线，方案中的环境验收要求仍需按实际证据判断。

## 2. 背景

重设计前，连接中心、常驻连接表单、远端文件、终端和监控同时排列，终端空间被压缩。面板开关混入内容标签，HeroUI 与原生控件、菜单样式不一致。连接错误集中在左栏，监控直接显示底层错误，缺少明确上下文。

参考截图位于 `C:/Users/Sanjeev/Desktop/PixPin_2026-11-02_09-51-19.png`，不将含真实远端信息的原图加入 Git。截图中的 `Process exited with status 2` 来自监控区域。实施中使用工作树原始脚本在 `sg1` 复现 CRLF 导致的退出码 2，LF 版本成功，已修复嵌入边界换行；应用真实采集链路仍需安全注入凭据验证。

重设计前使用 Wails 默认图标，本次已替换操作系统入口及分发资源。

## 3. 目标与范围

### 目标

- 应用内容区左上角不常驻显示“栈桥”“TermQuay”或应用图标，直接服务于连接与工作区操作。这是明确的用户要求。
- 重组为顶部连接标签、左侧轻量导航与可切换侧栏、中央终端/编辑器、按需右侧监控、底部状态与传输面板。
- 保留两层标签语义：外层为连接工作区，SSH 内层为独立终端和远端文件。
- 连接列表与文件浏览共用左侧内容栏，移除常驻新建/编辑连接表单，完成独立连接弹窗与快速连接入口。
- 完善连接搜索、分组树、协议筛选、稳定 ID 关联、连接取消、身份确认、错误反馈和凭据编辑表达。
- 统一文件浏览、菜单、编辑、保存、冲突及关闭草稿交互，保持既有文件安全契约。
- 重整监控、传输、备份恢复和 RDP 操作入口，实现命令搜索、键盘操作、专注模式和桌面窄窗口适配。
- 制作“伸向远端的栈桥”几何应用图标，以 SVG 为源稿，导出并接入各平台资源。
- 完成真实界面视觉复核、必要检查、文档同步和小步中文提交。

### 不包含

- 账号服务、团队系统、云端控制面、插件框架、分布式架构和商业连接限制。
- SSH Agent、跳板机、端口转发、自动备份、格式导入、完整 IDE 或移动端产品。
- 为重设计全面重写协议、密码学、存储或备份格式，升级无关依赖，批量清理无关代码。
- 旧布局兼容层、数据迁移工程，未经要求清空实际本地数据。
- 自绘原生窗口控制、签名分发、推送、Release、修改远端系统或安装远端依赖。
- 通过占位数据、隐藏错误或关闭身份验证制造通过结果。

## 4. 技术上下文

### 架构与事实来源

- Go/Wails v3 管理连接、认证、会话、传输、采集、存储和备份；React/TypeScript 管理视图、交互和编辑草稿。
- 沿用 Vite、Tailwind CSS、HeroUI、pnpm、Go Modules，以及 xterm.js、CodeMirror、IronRDP。版本以 [go.mod](go.mod)、[frontend/package.json](frontend/package.json) 和锁文件为准。
- 遵守 [AGENTS.md](AGENTS.md)、[docs/architecture.md](docs/architecture.md) 与 [docs/development.md](docs/development.md)。架构文档维护契约，实现代码与测试维护当前行为。
- SQLite 当前有 groups、connections、credentials、settings 表。连接稳定 ID 与远端地址分离；凭据字段加密，主密钥由系统密钥库保护。密钥库不可用时提供显式会话存储。
- Wails 控制调用使用生成绑定，终端数据使用有序、有界 Streams。调整 Go 接口后重新生成绑定，禁止手改派生产物。

### 设计参考与确定方向

实施前使用 `refero-design-system` 技能并读取其最新参考 [Refero Styles](https://styles.refero.design)。已选方向为紧凑、克制的深色专业工具，重点吸收表面层级、边界、排版和操作反馈。

具体参考为 [Linear](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1) 和 [Raycast](https://styles.refero.design/style/3b6a17f0-3bdf-418c-a95e-0b89e5a8b2f8)。页面包含官网样式提取，不能机械照搬营销布局、展示字号、品牌色或文案。以下设计值是栈桥方案，可在实际视觉复核中微调。

| 语义角色 | 建议值 |
| --- | --- |
| 工作区背景 | `#101216` |
| 导航表面 | `#17191E` |
| 浮层表面 | `#20232A` |
| 结构边界 | `#2C3039` |
| 主文字 | `#E6E9EF` |
| 次级文字 | `#9AA3B2` |
| 强调色 | `#8BA7FF` |
| 运行、警告、失败 | 绿、黄、红，配合图标与文字 |

正文 13–14px，辅助信息 12px，区域标题 14–16px；终端初始字号 14px，行高约 1.3，支持调整。常规控件高 32px，表单输入可用 36px。间距以 4px 为基准，常用 8/12/16/24px。按钮、输入框圆角 6px，弹窗约 10px。使用系统 UI 字体和完整中文回退，终端/编辑器采用一致等宽字体策略。统一语义变量，首轮完成深色主题，不要求同时交付浅色主题。

## 5. 实施前实现分析

| 文件 | 当前职责及重构关注点 |
| --- | --- |
| [frontend/src/App.tsx](frontend/src/App.tsx) | 混合应用布局、连接目录、表单、身份确认、工作区、退出和传输入口；使用共享 busy/error；保存连接当前返回 void；缺少配置 ID 与运行工作区的明确关联 |
| [frontend/src/style.css](frontend/src/style.css) | 散落硬编码颜色、尺寸及控件样式；连接栏固定宽度；文件与监控另占栏位 |
| [frontend/src/main.tsx](frontend/src/main.tsx)、[frontend/hero.js](frontend/hero.js) | HeroUI Provider 与主题入口 |
| [frontend/src/features/files/SSHWorkspace.tsx](frontend/src/features/files/SSHWorkspace.tsx) | 同时持有文件浏览、草稿、独立终端、面板尺寸与监控；挂载时建立工作区 owner Stream，销毁时关闭整个工作区 |
| [frontend/src/features/terminal/TerminalView.tsx](frontend/src/features/terminal/TerminalView.tsx) | xterm 实例、输入、尺寸和输出消费确认；切换与显示尺寸重构必须保持字节确认契约 |
| [frontend/src/features/files/CodeEditor.tsx](frontend/src/features/files/CodeEditor.tsx) | CodeMirror 实例、主题、语言、Mod-s；实例目前按 path 建立，外部 content 更新不会自动替换编辑内容 |
| [frontend/src/features/files/TransferPanel.tsx](frontend/src/features/files/TransferPanel.tsx) | 任务列表及事件订阅随详情面板挂载；新增持续摘要需将状态所有权移到稳定挂载处 |
| [frontend/src/features/monitor/MonitorPanel.tsx](frontend/src/features/monitor/MonitorPanel.tsx) | 挂载订阅、销毁取消订阅；现有隐藏工作区仍可挂载面板，需明确可见性订阅规则 |
| [frontend/src/features/rdp/RDPView.tsx](frontend/src/features/rdp/RDPView.tsx) | WASM 桌面创建、连接、工具栏、尺寸和默认关闭的文本剪贴板 |
| [frontend/src/features/settings/BackupSettings.tsx](frontend/src/features/settings/BackupSettings.tsx) | WebDAV 配置、测试、快照列表、创建和恢复预览；操作当前按次输入配置 |
| [data.go](data.go)、[internal/store/store.go](internal/store/store.go) | 连接、分组、凭据与备份接口；SaveConnection 在新凭据留空时保留已有凭据，不会清空旧密码 |
| [app.go](app.go)、[lifecycle.go](lifecycle.go) | 工作区与退出、未保存内容协调 |
| [monitor.go](monitor.go)、[internal/monitor/sample.go](internal/monitor/sample.go) | Linux 监控订阅和采集；仅在实际诊断确认需要时修复相关采集问题 |
| [main.go](main.go) | 原生窗口、Streams、退出 Hook；保持原生标题栏，按需同步启动背景和图标入口 |
| [build/Taskfile.yml](build/Taskfile.yml) | common:generate:icons 从 appicon.png 生成 ICO/ICNS；另有可选 Icon Composer 输入 |
| [build/windows/Taskfile.yml](build/windows/Taskfile.yml) | ICO 接入 syso，资源文件更新不等于开发进程已加载新图标 |
| [build/darwin/Taskfile.yml](build/darwin/Taskfile.yml) | 开发/正式 app 包复制 icons.icns，DMG 卷图标默认引用同一文件 |
| [build/linux/Taskfile.yml](build/linux/Taskfile.yml) | PNG、desktop 与打包图标入口 |

## 6. 实现方案

### 6.1 应用骨架与状态所有权

修改 App.tsx，移除 wordmark、开发版常驻标签和品牌独占横栏。应用内顶部直接展示连接标签及必要操作。原生标题栏遵循平台行为，本轮不自绘标题栏；系统标题和程序元数据无需删除。

新增 `frontend/src/components/layout/Workbench.tsx`，组合顶部工作区标签、约 44px 轻量导航、约 240px 可调整侧栏、中央内容、可收起监控和底部状态栏。新增 `frontend/src/components/layout/WorkspaceTabs.tsx` 承担外层标签与切换、关闭行为。文件名可随项目实际组织小幅调整，不建立通用布局框架。

左侧导航为连接、当前 SSH 的文件和底部设置，提供 Tooltip、可访问名称、键盘焦点与选中状态。连接和文件共用一个内容栏；RDP/无 SSH 工作区时不展示可用文件操作。切换侧栏不销毁 SSHWorkspace、PTY、RDP、目录状态或草稿。

首次进入显示连接目录；连接成功焦点进入终端。文件和监控按需打开，记住用户主动调整的面板宽度与展开偏好。布局偏好可使用命名空间明确的 localStorage；其中不得存连接密码、私钥或令牌。恢复布局不得自动恢复远端 Shell 或重放命令。

右侧监控约 240–280px，支持调整与收起。窗口变窄时优先收起辅助栏，监控可改为临时侧面板。专注模式收起左右面板，保留连接标签和必要操作。适配现有 900×600 最小窗口以及 1280×820、1366×768、1440×900 等桌面窗口，尺寸按 CSS 像素衡量。

连接配置 ID、工作区 ID、终端 ID、文件路径分别建模。通过配置稳定 ID 定位已打开工作区；双击连接优先定位已有工作区，菜单可显式新建另一工作区，不按名称或 host 猜测身份。错误和等待状态归属具体连接尝试或模块，防止一次连接失败污染另一工作区。

### 6.2 连接目录与连接弹窗

新增 `frontend/src/features/connections/ConnectionSidebar.tsx`、`ConnectionDialog.tsx`、`HostTrustDialog.tsx`；确有必要时新增同目录 `useConnections.ts` 提取目录与操作逻辑，避免将新逻辑继续堆入 App.tsx。

- 目录包含搜索、分组树、协议筛选和新建入口。分组树承担分组筛选，保留新增、编辑及删除的有效操作，遵循后端父子引用约束。连接单击选择，双击或 Enter 打开，选中行提供连接按钮及操作菜单。
- 名称为主、地址为次，协议简洁展示。编辑、删除和新建工作区进入菜单；菜单同样可通过键盘访问。空状态简短，提供新建连接入口。
- 新建/编辑弹窗约 520px，标签放在输入框外；主机与端口同排。SSH 选择密码/私钥认证，按认证方式展示字段；RDP 展示域并隐藏 SSH 字段。
- 新建弹窗提供取消、保存、保存并连接；快速连接使用相同表单结构，明确临时连接且不自动持久化。
- 编辑时显示已保存凭据并提供更换入口，凭据留空沿用后端保留语义。不得把已有 SSH 秘密读取回前端，也不虚构凭据类型；需要类型信息时仅增加不含秘密的元数据。
- 保存与连接是两个独立结果。保存成功、连接失败时保留已保存配置并清晰展示连接失败，不回滚保存，不重复新建配置。保存并连接后建立正确配置 ID 关联。
- 首次身份确认单独展示目标和指纹，取消后释放当前尝试；已知身份变化阻断连接。RDP 的有效期、CA/主机名验证和固定指纹策略继续由现有后端约束。
- 连接可取消，失败保留非秘密草稿，秘密按现有认证边界处理；弹窗关闭和异步完成之间不得留下失去所有者的会话。

### 6.3 终端、文件和编辑

从 SSHWorkspace.tsx 提取 `frontend/src/features/files/FileBrowser.tsx`，将文件浏览区域接入共用侧栏，保留工作区级 owner 与草稿所有权。目录请求继续支持取消并避免旧结果覆盖新目录。

- 文件工具栏包含上级目录、刷新、上传和新建目录；面包屑路径可切换为编辑输入，按 Enter 跳转。
- 单击选择、双击打开；方向键/Enter/F2/Delete 在文件列表焦点上下文中操作。行菜单悬停与键盘聚焦均可发现，使用现有组件库浮层能力避免窗口边缘裁切。
- 重命名行内编辑；删除展示具体目标并确认，保留真实错误；路径始终按 POSIX 处理，不拼接进 Shell。
- 中央标签只容纳终端和文件；文件、监控等面板开关移至工具区。相同 basename 的文件通过路径信息区分。
- 终端切换、弹窗关闭及调整布局后正确恢复焦点和尺寸；避免隐藏容器触发错误尺寸或重建终端。支持字体调整，保留有界 scrollback、输入队列和写入完成后的消费确认。
- 文件关闭提供保存并关闭、放弃修改、取消；保存成功后才关闭。工作区/应用关闭处理全部草稿，保存失败留在编辑状态。保持 SetWorkspaceDirty 与原生退出契约同步。
- 冲突时保留本地草稿，提供明确的重新读取/复制草稿等操作。重新读取需要明确处理覆盖本地草稿，并同步 CodeMirror 实际文档；不得用更新 React content 假装编辑器已更新。
- 保持 UTF-8、文件大小、符号链接、权限、版本检查与私有暂存目录等既有文件契约，不引入自动强制覆盖。

### 6.4 监控、传输、RDP 与设置

修改 MonitorPanel.tsx，将采集绑定到当前工作区且面板实际可见的订阅。关闭面板、切换到其他工作区或进入覆盖工作区的设置页时取消对应订阅，返回后恢复。避免重复订阅，监控采集不干扰交互终端。CPU/内存优先展示，网络与磁盘分层展开；首次采样、未知与失败显示未知或错误，时间和样本失效状态准确。

显示“监控采集失败”、重试及可展开技术详情，区分采集失败、终端退出和 SSH 工作区断线。根据真实输出诊断截图中的退出码；确认原因后局部修复 monitor.go 或 internal/monitor，缺少真实资源时记录缺口，禁止推断通过。

新增 `frontend/src/features/files/useTransfers.ts` 管理持续挂载的任务状态与订阅，复用现有 ListTransfers/transfer:changed。TransferPanel.tsx 展示详情，状态栏展示任务摘要和失败状态。上传/下载启动后更新摘要，用户主动打开详情，操作不抢走终端焦点。详情可展开、收起、调高；收起不取消任务，关闭所属工作区继续按既有契约取消任务。

修改 RDPView.tsx 统一工具栏及错误样式，集中组合键、尺寸、全屏与文本剪贴板操作；剪贴板仍默认关闭、按会话开启。工作区切换不能重建 WASM 或重新连接。保留实际桌面状态并明确 WASM 装载、连接和远端断开差别。

新增 `frontend/src/features/settings/SettingsView.tsx` 容纳外观/终端必要选项、备份恢复和关于入口；修改 BackupSettings.tsx，按 WebDAV 配置、快照创建和快照列表组织，保留独立备份密码、显式携带凭据、恢复差异预览及替换确认。当前按次输入 WebDAV 配置，不扩展凭据持久化或自动备份。

新增 `frontend/src/components/CommandPalette.tsx`，实现连接查找、切换工作区及常用界面命令；保留所有功能的鼠标入口。快捷键按系统和焦点上下文安排，终端控制键与 RDP 远端输入不能被无条件拦截。

### 6.5 视觉系统

新增 `frontend/src/styles/tokens.css` 并由 style.css 引入，统一应用、HeroUI、CodeMirror 和 xterm 的语义色、排版、间距、边界、圆角与焦点样式。按需调整 hero.js 与 main.tsx，使用已有组件库，避免为按钮/菜单重复造完整组件库。

主工作区用布局、表面层级和分隔线组织，保留稳定连续画布。检查 hover、focus-visible、selected、disabled、loading、empty、error；正文对比度按实际颜色验证，状态同时有文字或图标表达。

应用中移除重复说明、装饰性卡片和无必要成功弹窗。必要的风险说明、字段校验、身份确认、草稿和错误信息保留。图标按钮须有可访问名称，菜单与弹窗有焦点管理，原生窗口拖动和窗口控制继续可用。

### 6.6 应用图标

执行已确认的“伸向远端的栈桥”主方案，以 `build/appicon.svg` 为唯一矢量源稿。深石墨底板上，浅青色、宽而连续的几何桥面从下方伸入，末端向右延展，内部通过克制留缝暗示连接通道；轻微圆角，整体略偏中心，以留白保留方向感。

造型安静、可靠、清楚，不加入文字、通用终端提示符、海浪、服务器或桥墩等细节堆叠。图标青色与界面蓝色强调可各司其职。大尺寸可有极轻明暗，小尺寸优先清晰轮廓。最终交付一套一致符号，平台底板、透明边距可适配。

使用 SVG 精确绘制，图像生成仅在确有必要探索材质时使用，并遵循 imagegen 技能。无需再次询问概念选择或交付多套候选才继续。

导出并检查 16、20、24、32、48、256px 与高分辨率主图。小尺寸必要时简化留缝，确需独立小尺寸源时放在 build/ 并明确用途。使用成熟 SVG 渲染/图标工具，优先复用已有生成链，不手写 ICO/ICNS 编码器，不添加无关运行时依赖或新全局工具配置。

替换 `build/appicon.png`，经根任务 `wails3 task common:generate:icons` 生成 `build/windows/icon.ico` 和 `build/darwin/icons.icns`。具体参数以当前 Taskfile 和实际 CLI 帮助为准。检查 Linux PNG/desktop 路径、Windows syso 与 macOS app 包。按实际引用处理 `build/darwin/dmg-file-icon.png`、`dmg-file-icon.icns` 中的默认 Wails 图案；DMG 背景只在确含旧品牌且必要时修改。

原生图标通过任务栏、Dock、启动器和关于页面展示，应用内容区左上角仍不得常驻放置。重建和重启原生程序后检查实际加载结果，不将图标文件生成或系统缓存误认成运行时验收。Windows 之外未具备环境的平台明确保留待验证。

### 6.7 API、数据库和配置

- 优先复用现有接口。SaveConnection 当前只返回 error；若保存并连接需要返回稳定 ID，可在 data.go 让其返回保存后的连接元数据，更新 data_test.go 与直接调用方，并重新生成绑定，不通过地址/名称反查新配置 ID。
- 如需区分凭据类型或错误类别，最小扩展非秘密元数据/结构化错误并同步直接调用方与测试。保留原始技术详情，不仅靠模糊字符串将错误包装成猜测原因。
- 默认无需数据库 Schema 或快照格式变化；布局偏好、字体设置不夹带连接秘密。无迁移要求不构成删除用户文件或数据的授权。
- 仅按图标、窗口背景、必要打包引用修改 main.go、build/ 配置。无需引入 Icon Composer、新主题框架或状态管理依赖。
- 实现结束按最终 diff 更新 README、architecture 与 development 中受影响的布局、入口、操作和验证说明，修正被移动文件的导航链接。

## 7. 文件影响范围

### 修改

- `frontend/src/App.tsx`、`frontend/src/style.css`，按需调整 `frontend/src/main.tsx`、`frontend/hero.js`。
- `frontend/src/features/files/SSHWorkspace.tsx`、`CodeEditor.tsx`、`TransferPanel.tsx`。
- `frontend/src/features/terminal/TerminalView.tsx`、`features/monitor/MonitorPanel.tsx`、`features/rdp/RDPView.tsx`、`features/settings/BackupSettings.tsx`。
- `build/appicon.png`、`build/windows/icon.ico`、`build/darwin/icons.icns`；按实际引用处理 DMG 图标与平台配置。
- `main.go`、`data.go`、相关直接调用方及有效测试，仅在上述需要时修改；Go 接口变化同步生成 `frontend/bindings/`。
- `monitor.go`、`internal/monitor/` 及对应测试，仅在确认实际采集缺陷且与当前验收直接相关时修改。
- `README.md`、`docs/architecture.md`、`docs/development.md`，按最终语义变化同步。

### 新增

- `frontend/src/styles/tokens.css`。
- `frontend/src/components/layout/Workbench.tsx`、`WorkspaceTabs.tsx`。
- `frontend/src/features/connections/ConnectionSidebar.tsx`、`ConnectionDialog.tsx`、`HostTrustDialog.tsx`；必要时 `useConnections.ts`。
- `frontend/src/features/files/FileBrowser.tsx`、`useTransfers.ts`。
- `frontend/src/features/settings/SettingsView.tsx`、`frontend/src/components/CommandPalette.tsx`。
- `build/appicon.svg`；确有小尺寸光学校正需要时新增对应 SVG 源稿。
- 有维护价值的行为回归测试按现有测试组织增加；不为颜色/静态样式机械新增测试框架。

以上组件是职责落点，可随实际组合微调。不要先建立空组件、通用插件机制或无业务用途的抽象层。

### 避免修改

无关协议模块、备份格式、加密设计、远端配置、第三方许可证原文、全局工具链、参考仓库及用户已有改动。除非确有新依赖需求，不修改依赖清单和锁文件。

## 8. 约束条件

- 开始时检查分支、工作区和相关文件当前状态；本次交接检查时为 main 且工作区干净，这不代表下一会话仍然如此。保留用户改动，必要时从 main 建立任务分支。
- 使用简体中文撰写 UI、文档和提交描述，标识符、协议字段保留项目命名。文件采用 UTF-8/LF，遵守 .gitattributes。
- 完成授权范围内的实现、验证和提交，常规可逆选择自行处理。不要每个阶段重新请求同一授权，也不要在完成骨架后把后续已列目标留作空壳。
- 允许重大前端重构，无需旧布局/数据迁移；安全、数据保护、协议和资源契约继续有效。
- 始终保留端到端背压、独立 PTY、SFTP/监控通道隔离、有限并发/缓冲、明确会话关闭路径。切换界面不等于关闭连接。
- 密码、私钥、口令、WebDAV 凭据和令牌不进入 Git、截图、日志或持久化前端状态。不得读取其他项目配置或完整环境寻找秘密。
- 真实 SSH 可按 AGENTS.md 使用授权的 sg1，先只读识别，应用链路用应用协议栈验证。文件测试限定本次 `/tmp/termquay-*` 目录并清理；缺少安全凭据时保留验证缺口。真实 WebDAV 仅使用独立测试集合。
- 独立只读检查可并行；当前任务未要求多 Agent，不自行派发子 Agent。

### 中文小提交

每个完成的、可审阅且通过对应检查的完整改动及时提交。格式 `<type>(<scope>): <简短中文描述>`，不要把 UI 行为变化写成仅代码格式的 style 提交。建议按设计变量/骨架、连接流程、文件编辑、监控传输、设置/RDP、命令与适配、图标等职责拆分；实际以可运行且完整的改动为边界，不制造无法编译的中间提交。

示例：`feat(ui): 重建终端工作台布局`、`feat(connections): 实现独立连接弹窗`、`fix(files): 保存成功后关闭文件标签`、`feat(assets): 替换栈桥应用图标`。每个功能提交同步其必要测试和文档；必要的结构拆分可先形成 refactor 提交。

提交前检查最终 diff、敏感内容、文档影响和暂存清单，显式暂存任务文件，不使用 git add . 混入用户文件。保持线性历史，不推送、不发布、不擅自 amend 用户提交。结束报告实际 commit ID、完成项、验证结果和缺口。

## 9. 验收标准

此清单保留原方案完整范围。实现与已执行检查见 [重设计验收记录](docs/development.md#重设计验收记录2026-11-02)；真实远端、其他平台、系统缩放和输入法仍有环境缺口，不能将实现完成或本地替身结果视作全部原生与真实服务验收通过。

- [ ] 应用内容区左上角无常驻品牌文字或应用图标，原生窗口和系统入口正常。
- [ ] 连接与文件共用侧栏，中央终端/编辑器为主要连续区域；两层标签与面板开关语义清楚。
- [ ] 连接搜索、分组树、协议筛选、新建、编辑、删除和快速连接可用；双击/Enter、已有工作区定位与显式新建工作区行为正确。
- [ ] 保存、保存并连接、临时连接语义准确；稳定 ID 关联正确；编辑保留已有凭据、更换凭据、失败和取消均正确。
- [ ] 首次身份核对可用，已知 SSH/RDP 身份变化阻止连接；不通过 UI 重设计削弱验证策略。
- [ ] 切换标签/侧栏/设置不丢草稿、不重建会话；关闭终端/工作区/应用按所属生命周期释放资源。
- [ ] 文件路径导航、选择、打开、新建目录、重命名、删除、上传下载及菜单键盘操作可用，浮层不被裁切。
- [ ] 保存并关闭等待保存成功；失败与冲突保留草稿，重新读取反映到真实 CodeMirror 文档；未保存工作区和退出处理完整。
- [ ] 监控按可见性订阅/取消，未知与失败表达准确；采集失败不误报整个 SSH 断线；截图中的退出原因得到验证或明确记录剩余缺口。
- [ ] 传输摘要持续更新；启动传输不抢焦点；详情收起任务继续，所属工作区关闭遵循取消契约。
- [ ] RDP 工具栏、焦点、尺寸、全屏和默认关闭的剪贴板入口保持正确；备份恢复仍有凭据选择、差异预览和明确替换确认。
- [ ] 命令搜索、完整鼠标入口、键盘导航、专注模式和窄窗口布局可用；快捷键不无条件劫持终端/RDP 输入。
- [ ] 界面、HeroUI、xterm、CodeMirror 的主题与状态一致，无重复文案、装饰卡片和无必要成功弹窗；可访问名称、焦点与文字对比度经过检查。
- [ ] SVG 图标源稿及 PNG/ICO/ICNS 接入完成；16/20/24/32/48/256px 和高分辨率主图视觉清晰，深浅系统背景下可辨识；实际 Windows 原生窗口/任务栏验证，其他平台分别记录结果。
- [ ] 在原生 Wails/WebView2 检查 100%、125%、150% 系统缩放、中文输入、焦点、调整窗口与多会话。浏览器预览不充当原生验证。
- [ ] 前端执行 `pnpm --dir frontend check` 与 `pnpm --dir frontend build`；Go 接口或模型修改后、前端检查前运行 `wails3 generate bindings -ts -i` 并检查生成 diff。
- [ ] 按改动运行相关 Go 测试：连接/凭据改动覆盖 data_test.go，生命周期/背压覆盖 internal/ssh，文件/采集/传输改动覆盖相应已有测试。根包先具备 frontend/dist；有 race 工具链时按需运行 `go test -race ./...` 或受影响包，环境不足则明确记录。
- [ ] 按开发说明区分单元、本地集成、真实 SSH、真实 WebDAV、真实 RDP 和原生桌面验证，不把 mock、跳过或交叉编译算作真实通过。
- [ ] README、架构和开发说明与最终布局、入口、契约及代码导航一致。
- [ ] 各完整改动形成小型中文 Conventional Commits，最终工作区状态和未验证项清楚，无推送或发布。

## 10. Agent 注意事项

- 第一阶段优先完成可用的新骨架、统一侧栏与连接弹窗，再完成其他已列模块和图标；阶段划分用于小步验证与提交，不缩减整体交付范围。
- 实施前读取 refero-design-system；代码重构按适用技能执行，提交按 conventional-commits。SVG 绘制无需调用图像生成；选择图片工具时先使用 imagegen 技能。
- SSHWorkspace 当前 cleanup 会 CloseWorkspace。把整个组件挂到“当前选择的是文件侧栏”条件下会导致切换侧栏断线，必须将会话 owner 留在稳定挂载层。收起文件浏览也不能丢失草稿或重复发起 SFTP 请求。
- xterm 消费确认必须留在 term.write 完成回调；隐藏/显示尺寸和事件订阅不能因布局抽取丢失。关闭一个终端不等于关闭整个 SSH 工作区。
- SaveConnection 空凭据保留旧值已从后端确认。不要将此写成清空旧密码的缺陷，也不要在 UI 中伪造已保存秘密。保存后的连接必须用稳定 ID 对应工作区。
- 监控面板关闭与详情面板收起有不同生命周期：监控停止采集，传输继续并更新摘要。不要用统一的“隐藏即销毁所有状态”实现两者。
- Wails 的 RDP 连接目前依赖先挂载视图、再调用 connect 的顺序；重构弹窗和连接状态时保留 ready、取消与资源释放路径，认证材料不能进入通用全局状态。
- 原始采集错误尚未定位；现有真实 RDP 仍有验收缺口。分别诊断和报告，不能依据类型检查或浏览器替身宣称真实服务通过。
- 开发环境可能已在运行。先确认当前入口和进程，不随意终止用户启动的开发进程；Vite 默认端口及来源约束以配置为准，不硬编码到新功能或放宽 RDP 来源白名单。
- 图标需要本机重新构建/重启验证；Windows syso 和系统图标缓存、macOS app 资源与 Linux desktop 入口分别处理。不要为使截图好看在左上角重新放 Logo。
- 图标导出确需脚本时先说明必要性，使用成熟工具；临时脚本放临时目录，Python 统一由 uv 管理。无需为了读文件、替换文本或常规项目命令创建脚本。
- 本方案对应的产品实现已获本次会话授权并分步提交；后续以当前代码和验收记录继续，不从实施前基线重新开工。
