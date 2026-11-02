# 开发与使用说明

本文提供从源码运行、日常使用、验证和本地打包入口。设计理由与行为契约见 [架构文档](architecture.md)。以下命令从仓库根目录执行。

## 环境与定义入口

- Go 最低版本与建议工具链由 [go.mod](../go.mod) 的 `go`、`toolchain` 声明决定。允许自动工具链下载的环境会按需选择工具链；使用更高版本时仍需验证兼容性。
- pnpm 版本由 [frontend/package.json](../frontend/package.json) 的 `packageManager` 声明决定，Node 需满足锁定 pnpm/Vite 的要求。使用 [锁文件](../frontend/pnpm-lock.yaml) 安装，不改其他项目或全局工具配置。
- Wails CLI 与 `go.mod` 中 Wails 模块版本保持一致。下方安装命令从模块定义读取版本，不另维护版本常量。
- 原生依赖随目标平台准备：macOS 使用 Command Line Tools；Windows 运行需要 WebView2；Linux 构建需要 C 编译器及 Wails 对应的 GTK/WebKit 开发库。包名随发行版和构建选项核对，不把交叉编译结果当作原生验证。

| 内容 | 定义入口 |
| --- | --- |
| 前端脚本、依赖和 Node 包管理器 | [frontend/package.json](../frontend/package.json) 与锁文件 |
| 开发服务器和端口 | [frontend/vite.config.ts](../frontend/vite.config.ts)、[Taskfile.yml](../Taskfile.yml) |
| 热重载、产品元数据与资源生成 | [build/config.yml](../build/config.yml) |
| 通用绑定与前端构建 | [build/Taskfile.yml](../build/Taskfile.yml) |
| 平台构建、包格式和签名参数 | [macOS](../build/darwin/Taskfile.yml)、[Windows](../build/windows/Taskfile.yml)、[Linux](../build/linux/Taskfile.yml) 的任务定义 |

Taskfile 保留 Wails 模板任务。出现 server、Docker 或 iOS 任务不表示产品支持相应部署形态；当前交付范围是桌面应用。自定义开发端口时，核对 [RDP 服务](../rdp.go) 的精确来源白名单；它不会随 Vite 端口自动变化，不得放开为任意来源。

## 首次运行

仓库已包含生成绑定，先安装依赖并构建前端资源，供桌面根包嵌入：

```sh
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build
```

将匹配的 Wails CLI 安装到已忽略的 `.tools` 目录，并在当前终端加入 PATH。

Windows PowerShell：

```powershell
$wailsVersion = go list -m -f '{{.Version}}' github.com/wailsapp/wails/v3
$env:GOBIN = Join-Path (Get-Location) '.tools'
go install "github.com/wailsapp/wails/v3/cmd/wails3@$wailsVersion"
$env:PATH = "$env:GOBIN;$env:PATH"
wails3 dev
```

macOS / Linux 的 sh 兼容 Shell：

```sh
wails_version=$(go list -m -f '{{.Version}}' github.com/wailsapp/wails/v3)
GOBIN="$PWD/.tools" go install "github.com/wailsapp/wails/v3/cmd/wails3@$wails_version"
export PATH="$PWD/.tools:$PATH"
wails3 dev
```

开发入口通过项目任务完成绑定生成和前端构建，再启动桌面与前端开发服务器。新终端需要重新将 `.tools` 加入 PATH。浏览器单独打开 Vite 页面无法代替原生 Wails 运行时验证。

## 日常修改与验证

Go 服务签名、模型或事件改变后重新生成绑定，生成目录为 [frontend/bindings](../frontend/bindings)。完整 Wails 构建也会执行该步骤；不要手工修补生成文件来掩盖后端定义问题。

```sh
wails3 generate bindings -ts -i
pnpm --dir frontend check
pnpm --dir frontend build
```

根包通过 `go:embed` 引入 `frontend/dist`，全新检出时先构建前端再编译或测试根包。后端检查可按影响范围选择：

```sh
go test -race ./internal/...
go test -race ./...
```

两条命令分别覆盖内部模块和含桌面服务的全部包，无需每次都运行。`-race` 需要当前平台支持的 race 工具链与 C 编译器；缺失时明确记录未完成竞态检查，普通测试通过不能替代它。纯文档修改检查内容、链接和 diff。

当前自动化主要是 Go 测试；前端 `check` 和 `build` 分别提供类型检查与构建验证，没有前端行为测试脚本。测试名称及实际覆盖以仓库测试为准。带凭据的真实服务测试可能在普通测试命令中执行；缺少配置时会跳过，必须区分通过与跳过。

### 真实 SSH 与 WebDAV

测试配置通过当前进程环境安全注入，不写入仓库或提交真实样例。以下是变量名，不是应用运行所必需的生产配置：

| 测试 | 必要变量 | 范围 |
| --- | --- | --- |
| `TestSG1PTY`、`TestSG1Files`、`TestSG1Monitor` | `SSH_MCP_SERVER_SG1_HOST`、`SSH_MCP_SERVER_SG1_PORT`、`SSH_MCP_SERVER_SG1_USERNAME`、`SSH_MCP_SERVER_SG1_PASSWORD`、`TERMQUAY_TEST_HOST_FINGERPRINT` | SSH 协议栈、隔离 SFTP 文件操作、Linux 采集 |
| `TestRealWebDAV` | `TERMQUAY_WEBDAV_URL`、`TERMQUAY_WEBDAV_USERNAME`、`TERMQUAY_WEBDAV_PASSWORD`、`TERMQUAY_WEBDAV_DIRECTORY` | 真实服务的密文往返、列表、解密和同名拒绝 |

SSH 指纹须来自已核对的测试目标，不能为跑通测试关闭身份校验。文件测试创建并清理本次 `/tmp/termquay-*` 目录；监控运行只读 Linux 采集。WebDAV 目录指定已有可写测试集合，测试在其中创建唯一子目录并清理。遵守 [远端操作边界](../AGENTS.md#凭据与远端操作)，MCP 连通不能替代应用自身链路验证。

监控脚本在 Go 嵌入边界统一为 LF。Windows 工作树曾保留 CRLF，原始字节经 `sh -s` 在真实 Linux 目标复现退出码 2，错误为 `set: Illegal option`；LF 版本成功。脚本执行成功与应用采集链路通过仍需分别验证。

```sh
go test -race -v ./internal/ssh ./internal/files ./internal/monitor -run TestSG1
go test -race -v ./internal/backup -run TestRealWebDAV
```

RDP 自动化目前使用隔离 TLS 目标验证桥接和身份策略，没有真实 Windows 桌面测试入口。真实画面、输入、剪贴板、多会话和各原生 WebView 必须另外验收。

## 使用说明

### 连接与工作区

左侧导航切换连接目录和当前 SSH 文件，二者共用可调整侧栏。顶部外层标签表示连接工作区，SSH 内层标签表示独立终端或文件；文件和监控开关位于导航与工具区。应用内容区不常驻展示品牌，系统标题栏保留原生行为。

连接目录支持搜索、协议筛选和分组树；单击选择，双击或 Enter 连接并优先定位同配置 ID 的已有工作区，菜单可新建另一工作区。新建、编辑使用独立弹窗。“保存”保存配置与加密凭据；“保存并连接”先保存，连接失败仍保留该配置。“快速连接”使用临时配置，不自动保存。编辑默认沿用已保存凭据，可选择更换，秘密留空仍保留后端旧值。

SSH 支持密码或私钥内容及可选口令；RDP 使用用户名、密码及可选域。首次 SSH 主机或未通过系统 CA 验证的 RDP 证书在独立身份弹窗核对指纹，已知身份变化阻止连接。连接过程可取消。详细策略见 [身份与本地数据](architecture.md#身份凭据与本地数据)。

应用数据位于 `os.UserConfigDir()` 下的 `TermQuay` 目录，数据库名为 `termquay.db`，路径与密钥库关联规则以 [存储入口](../data.go) 和 [密钥库实现](../internal/store/vault.go) 为准。复制数据库不能替代跨设备备份恢复。密钥库不可用时，界面允许明确选择会话存储；其生命周期与安全边界见架构文档。

切换外层标签、侧栏和设置保留会话，关闭工作区释放资源。SSH 内层标签切换独立终端与文件；文件列表单击选择、双击或 Enter 打开，方向键移动，F2 重命名，Delete 进入删除确认。路径面包屑可跳转，“编辑目录路径”支持输入完整路径。

文件、工作区和应用关闭前处理全部草稿，可保存并关闭、放弃或取消；保存失败保留草稿和标签。保存期间继续编辑会保留新增修改，关闭需再次处理。冲突后可复制草稿，或确认放弃草稿并重新读取远端内容，编辑器同步实际文档。重新打开连接不会恢复原来的远端 Shell。传输面板收起后任务继续，关闭工作区会取消任务。RDP 进入连接状态后使用工具栏操作组合键、尺寸、文本剪贴板和全屏，真实目标行为仍待验收。

监控随当前工作区可见性启停，进入设置、切换连接或收起面板会取消采集。首次增量指标显示未知，失败可重试并展开技术详情；过期样本不显示为实时指标。窄窗口将监控放入临时侧面板。底部传输摘要持续更新，上传下载不自动打开详情，点击摘要查看、取消或移除任务，可拖动上边界调整详情高度。

在线编辑的文件类型、大小、权限与并发覆盖限制见 [远端文件契约](architecture.md#远端文件与监控)。不适合在线保存的文件应下载处理，避免误认为编辑器能够保留全部远端元数据。

设置包含外观与终端、备份恢复、关于；终端字号调整不会重建会话。顶部命令搜索支持查找连接、切换工作区和常用界面操作，方向键选择、Enter 执行、Escape 关闭。`Ctrl/⌘ + Shift + P` 在普通界面打开搜索，终端、编辑器和 RDP 输入区域保留各自快捷键，使用顶部按钮打开搜索。专注模式收起左右辅助面板；窄窗口优先保留中央区域，侧栏可手动打开为临时面板。

### WebDAV 快照

在设置的“备份恢复”分类填写 WebDAV 地址、登录信息、相对备份目录和独立备份密码。使用 HTTPS，隔离本地测试允许回环 IP 的 HTTP。目录必须位于服务商已有可写集合下，界面初始值见 [BackupSettings](../frontend/src/features/settings/BackupSettings.tsx)；服务商不允许在根集合创建目录时，改用其授权集合下的相对路径。

“测试连接”检查基址目录读取，不证明指定目录能创建或发布快照。“创建快照”完成后再通过列表确认。需要跨设备带回密码或私钥内容时，显式勾选携带凭据并妥善保管独立备份密码。当前 WebDAV 操作按次填写配置并手动执行。

恢复时先读取快照、输入备份密码并预览，确认后替换连接、分组和凭据。具体替换范围、预览失效条件和本机设置保留规则见 [恢复契约](architecture.md#加密备份与恢复)。

## 构建与本地打包

```sh
wails3 build
wails3 task package
```

本机构建产物进入 `bin/`，Windows 可执行文件带 `.exe`。macOS 默认生成应用包并作本机 ad-hoc 签名；Windows 默认 NSIS 打包需要 `makensis`，MSIX 使用相应 Windows 工具；Linux 包格式及工具按平台 Taskfile 选择。完整构建任务可能执行 `go mod tidy` 并更新绑定，完成后检查实际 diff。

`build/config.yml` 是产品元数据与资源生成入口，平台产物仍由 `build/` 中模板和任务决定。修改 `info` 或文件关联时按该文件说明更新资源，再检查生成 diff；资源生成可能覆盖手工定制，不能用一次重新生成冲掉已有打包改动。

应用图标以 [build/appicon.svg](../build/appicon.svg) 为唯一矢量源稿。使用 SVG 渲染工具导出 `build/appicon.png`（1024px）、Linux 的 `build/linux/icon-128.png` 和 DMG 的 `build/darwin/dmg-file-icon.png`，然后运行 `wails3 task common:generate:icons` 生成 ICO/ICNS。DMG 文件图标沿用同一符号，将生成的 `icons.icns` 同步到 `dmg-file-icon.icns`。Windows 构建由 syso 嵌入 ICO，macOS app 包与 DMG 卷引用 ICNS，Linux 包的 hicolor 路径使用对应 128px PNG。修改资源后需重新构建并启动原生程序检查系统入口，文件生成不能替代任务栏、Dock 或启动器验收。

当前打包入口不代表正式发行就绪。分发前补齐目标系统原生验证、签名分发所需资源和 [依赖许可审计](../THIRD_PARTY_NOTICES.md)，按平台核对声明材料随包携带情况；macOS 应用包已有复制入口，其他平台仍需核对。推送、Release 和签名分发需相应授权。
