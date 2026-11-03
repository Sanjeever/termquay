# 第三方依赖声明

TermQuay 采用 Apache-2.0。各依赖保留其原有许可证、版权与声明。

- [go.mod](go.mod)、[go.sum](go.sum) 固定 Go 依赖版本。[Go 收集清单](build/licenses/go/modules.json) 记录收集时 macOS、Windows 与 Linux 的依赖解析结果，目录内保存相应模块附带的许可证、NOTICE 和版权文件。
- Go 工具链原始许可证保存在 `build/licenses/go/Go/LICENSE`。
- [前端锁文件](frontend/pnpm-lock.yaml) 固定前端依赖。[前端收集清单](build/licenses/frontend/packages.json) 记录收集时的生产依赖元数据，目录内保存包附带的许可文件。以下按用途说明许可，具体版本以锁文件和收集清单分别核对。
- Wails 与前端运行时采用 MIT；React、HeroUI、xterm.js、CodeMirror 及大部分前端依赖采用 MIT。具体条款以各依赖原文为准。
- 终端搜索与链接使用 `@xterm/addon-search`、`@xterm/addon-web-links`，均采用 MIT；许可原文随包保存在前端许可目录。
- 快速连接使用 `github.com/google/shlex` 解析引号与词法，采用 Apache-2.0；不执行解析内容。许可原文保存在 Go 许可目录。
- 文件冲突对比使用 `@codemirror/merge`，采用 MIT；许可原文保存在前端许可目录。
- 代码缩略图使用 `@replit/codemirror-minimap`。已核对发布包及对应源码提交的 `package.json`，均声明 MIT；许可目录保存原始包元数据和标准 MIT 条款。作者信息沿用原始元数据，未补写上游没有提供的版权年份或权利人。高亮标签使用的 `@lezer/highlight` 已收集许可原文。
- Shell、INI、TOML 与 nginx 配置高亮使用 `@codemirror/legacy-modes`，采用 MIT；许可原文保存在前端许可目录。
- 有界目录扫描使用 `github.com/pkg/sftp/v2`，采用 BSD-2-Clause，许可原文保存在 Go 许可目录。采用预发布分页接口的理由及回归要求见 [远端文件契约](docs/architecture.md#远端文件与监控)。
- Windows SSH Agent 命名管道使用 `github.com/Microsoft/go-winio`，采用 MIT；许可原文保存在 Go 许可目录。
- 本地终端使用 `github.com/aymanbagabas/go-pty`（MIT）；其 `github.com/creack/pty`（MIT）和 `github.com/u-root/u-root`（BSD-3-Clause）许可原文保存在 Go 许可目录。
- 文件编码转换使用 `golang.org/x/text`，采用 BSD-3-Clause；LICENSE 与 PATENTS 原文保存在 Go 许可目录。
- 动态转发使用 `github.com/armon/go-socks5`，采用 MIT；SOCKS 协议解析复用该库，许可原文保存在 Go 许可目录。
- OpenSSH 配置解析使用 `github.com/kevinburke/ssh_config`，采用 MIT；许可原文保存在 Go 许可目录。
- Iron Remote Desktop 和 RDP 后端采用 `MIT OR Apache-2.0`。已核对 npm 发布来源证明、包摘要及源码标签，对应源码提交为 `e45f68c7e52297ca50d33b44c0ace36c9940fbe6`。WASM 许可目录保存固定源码锁文件、259 项 Rust normal/build 依赖的许可清单和原文、来源证明及 WASM 摘要；清单可能包含未链接的依赖。预构建 JavaScript 使用的 Svelte、UAParser.js、esm-env 和 clsx 材料另保存在该目录。
- `use-composed-ref` 的发布包及对应源码提交均明确声明 MIT，许可目录保存原始包元数据和标准 MIT 条款。上游未提供独立版权行，材料保留这一事实，不推断版权所有者或年份。

许可文件收集覆盖生产依赖树，可能包含未进入最终 bundle 的依赖和模块中的额外声明。本次发行核对覆盖当前 Go 与前端锁定依赖、已识别的预构建 JavaScript 和 WASM；可核验来源与输入摘要见 `build/licenses/review.json`，WASM 详细材料见 `build/licenses/wasm/`。

上述清单与许可副本是收集时的材料，不会随依赖升级自动更新。依赖或 WASM 制品变化时，按锁文件、实际分发产物与上游来源核对清单、许可和待办；保留第三方许可原文，不将本文件的包声明概述当作完整审计结果。

macOS 应用包和其他平台安装包分发时，需随包携带本文件、项目 `LICENSE` 与适用的依赖许可原文。

Windows 与 Linux 主程序内嵌本文件、项目许可和收集的依赖声明，可在“设置 → 关于 → 开源许可”读取。macOS 应用包另保留资源目录副本。新增 Markdown 更新日志展示使用 `react-markdown` 及其生产依赖，材料收集在前端许可目录。Wails 更新组件新增使用 `golang.org/x/mod`，采用 BSD-3-Clause，许可原文位于 Go 许可目录。

两项 npm 包的 MIT 声明分别核对 `replit/codemirror-minimap@eb03174ce67e177bb86297c84c0389491350ff21` 和 `Andarist/use-composed-ref@ea2c9d969f2f90a349f4c99338b806423824cea2`。条款文本取自 SPDX 的 MIT 标准文本，采用与上游声明一致的许可，不把作者元数据改写为新版权声明。此前待办将“没有独立 LICENSE 文件”视为缺少许可依据，本次依据发布包和固定源码的明确 SPDX 声明完成收集，并记录该判断。

## 发行前待办
