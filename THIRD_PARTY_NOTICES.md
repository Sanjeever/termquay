# 第三方依赖声明

TermQuay 采用 Apache-2.0。各依赖保留其原有许可证、版权与声明。

- [go.mod](go.mod)、[go.sum](go.sum) 固定 Go 依赖版本。[Go 收集清单](build/licenses/go/modules.json) 记录收集时 macOS、Windows 与 Linux 的依赖解析结果，目录内保存相应模块附带的许可证、NOTICE 和版权文件。
- Go 工具链原始许可证保存在 `build/licenses/go/Go/LICENSE`。
- [前端锁文件](frontend/pnpm-lock.yaml) 固定前端依赖。[前端收集清单](build/licenses/frontend/packages.json) 记录收集时的生产依赖元数据，目录内保存包附带的许可文件。以下按用途说明许可，具体版本以锁文件和收集清单分别核对。
- Wails 与前端运行时采用 MIT；React、HeroUI、xterm.js、CodeMirror 及大部分前端依赖采用 MIT。具体条款以各依赖原文为准。
- 终端搜索与链接使用 `@xterm/addon-search`、`@xterm/addon-web-links`，均采用 MIT；许可原文随包保存在前端许可目录。
- 带时间轴终端录制使用 `maze.io/x/asciicast`（MIT），离线回放使用 `asciinema-player`（Apache-2.0）；录制编码与播放器均在本机运行。Go 与 npm 包附带的许可原文已收集，播放器预构建 WASM 的传递依赖核对见发行前待办。
- 快速连接使用 `github.com/google/shlex` 解析引号与词法，采用 Apache-2.0；不执行解析内容。许可原文保存在 Go 许可目录。
- 文件冲突对比使用 `@codemirror/merge`，采用 MIT；许可原文保存在前端许可目录。
- 代码缩略图使用 `@replit/codemirror-minimap`。已核对发布包及对应源码提交的 `package.json`，均声明 MIT；许可目录保存原始包元数据和标准 MIT 条款。作者信息沿用原始元数据，未补写上游没有提供的版权年份或权利人。高亮标签使用的 `@lezer/highlight` 已收集许可原文。
- 多语言高亮、补全与语法提示使用 CodeMirror、Lezer 语言包及 `@codemirror/legacy-modes`，采用 MIT。YAML 诊断使用 `yaml`，采用 ISC；Markdown 预览使用 `react-markdown`、`remark-gfm` 和 `rehype-slug`，采用 MIT。对应生产依赖和许可原文保存在前端许可目录。
- WebP 图片预览使用 `golang.org/x/image`，采用 BSD-3-Clause；LICENSE 与 PATENTS 原文保存在 Go 许可目录。
- 有界目录扫描使用 `github.com/pkg/sftp/v2`，采用 BSD-2-Clause，许可原文保存在 Go 许可目录。采用预发布分页接口的理由及回归要求见 [远端文件契约](docs/architecture.md#远端文件与监控)。
- Windows SSH Agent 命名管道使用 `github.com/Microsoft/go-winio`，采用 MIT；许可原文保存在 Go 许可目录。
- 本地终端使用 `github.com/aymanbagabas/go-pty`（MIT）；其 `github.com/creack/pty`（MIT）和 `github.com/u-root/u-root`（BSD-3-Clause）许可原文保存在 Go 许可目录。
- 文件编码转换使用 `golang.org/x/text`，采用 BSD-3-Clause；LICENSE 与 PATENTS 原文保存在 Go 许可目录。
- 动态转发使用 `github.com/armon/go-socks5`，采用 MIT；SOCKS 协议解析复用该库，许可原文保存在 Go 许可目录。
- Docker 日志流解复用使用 `github.com/moby/moby/api/pkg/stdcopy`，采用 Apache-2.0；模块许可原文保存在 Go 许可目录。
- OpenSSH 配置解析使用 `github.com/kevinburke/ssh_config`，采用 MIT；许可原文保存在 Go 许可目录。
- Iron Remote Desktop 和 RDP 后端采用 `MIT OR Apache-2.0`。已核对 npm 发布来源证明、包摘要及源码标签，固定源码提交见 [核对记录](build/licenses/review.json)。[WASM 材料](build/licenses/wasm/) 保存源码锁文件、Rust normal/build 依赖许可清单和原文、来源证明及制品摘要；清单可能包含未链接的依赖。预构建 JavaScript 使用的 Svelte、UAParser.js、esm-env 和 clsx 材料另保存在该目录。
- `use-composed-ref` 的发布包及对应源码提交均明确声明 MIT，许可目录保存原始包元数据和标准 MIT 条款。上游未提供独立版权行，材料保留这一事实，不推断版权所有者或年份。

许可文件收集覆盖生产依赖树，可能包含未进入最终 bundle 的依赖和模块中的额外声明。发行核对覆盖记录中的 Go 与前端锁定依赖、已识别的预构建 JavaScript 和 WASM；可核验来源与输入摘要见 [核对记录](build/licenses/review.json)。

上述清单与许可副本是收集时的材料，不会随依赖升级自动更新。依赖或 WASM 制品变化时，按锁文件、实际分发产物与上游来源核对清单、许可和待办；保留第三方许可原文，不将本文件的包声明概述当作完整审计结果。

macOS 应用包和其他平台安装包分发时，需随包携带本文件、项目 `LICENSE` 与适用的依赖许可原文。

主程序通过 [assets.go](assets.go) 内嵌本文件、项目许可和收集的依赖声明，可在“设置 → 关于 → 开源许可”读取。[macOS 打包任务](build/darwin/Taskfile.yml) 另保留资源目录副本。Wails 更新组件使用 `golang.org/x/mod`，采用 BSD-3-Clause，许可原文位于 Go 许可目录。

上述两项无独立 LICENSE 文件的 npm 包，依据发布包与固定源码中的明确 MIT 声明收集条款。源码提交与 SPDX 文本来源统一记录在 [核对记录](build/licenses/review.json)，不把作者元数据改写为新版权声明。

下方标题是 [发行检查](scripts/release-check.mjs) 的待办入口；标题后留空表示无登记待办，新增事项会阻止标签发布。

## 发行前待办

- 新增 `asciinema-player` 的预构建 WASM 需按源码版本补充传递依赖与制品来源核对，并更新 `build/licenses/review.json` 中 Go 和前端锁文件输入；本轮包内许可收集不替代该项发行审计。
