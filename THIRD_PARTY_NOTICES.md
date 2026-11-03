# 第三方依赖声明

TermQuay 采用 Apache-2.0。各依赖保留其原有许可证、版权与声明。

- [go.mod](go.mod)、[go.sum](go.sum) 固定 Go 依赖版本。[Go 收集清单](build/licenses/go/modules.json) 记录收集时 macOS、Windows 与 Linux 的依赖解析结果，目录内保存相应模块附带的许可证、NOTICE 和版权文件。
- Go 工具链原始许可证保存在 `build/licenses/go/Go/LICENSE`。
- [前端锁文件](frontend/pnpm-lock.yaml) 固定前端依赖。[前端收集清单](build/licenses/frontend/packages.json) 记录收集时的生产依赖元数据，目录内保存包附带的许可文件。以下按用途说明许可，具体版本以锁文件和收集清单分别核对。
- Wails 与前端运行时采用 MIT；React、HeroUI、xterm.js、CodeMirror 及大部分前端依赖采用 MIT。具体条款以各依赖原文为准。
- 终端搜索与链接使用 `@xterm/addon-search`、`@xterm/addon-web-links`，均采用 MIT；许可原文随包保存在前端许可目录。
- 快速连接使用 `github.com/google/shlex` 解析引号与词法，采用 Apache-2.0；不执行解析内容。许可原文保存在 Go 许可目录。
- 文件冲突对比使用 `@codemirror/merge`，采用 MIT；许可原文保存在前端许可目录。
- 代码缩略图使用 `@replit/codemirror-minimap`，npm 包声明 MIT；收集清单对应版本的包与当时核对的上游仓库未附许可证原文，正式分发前须补齐许可与版权依据。高亮标签使用的 `@lezer/highlight` 已在生产依赖许可材料中收集。
- Shell、INI、TOML 与 nginx 配置高亮使用 `@codemirror/legacy-modes`，采用 MIT；许可原文保存在前端许可目录。
- 有界目录扫描使用 `github.com/pkg/sftp/v2`，采用 BSD-2-Clause，许可原文保存在 Go 许可目录。采用预发布分页接口的理由及回归要求见 [远端文件契约](docs/architecture.md#远端文件与监控)。
- Windows SSH Agent 命名管道使用 `github.com/Microsoft/go-winio`，采用 MIT；许可原文保存在 Go 许可目录。
- 本地终端使用 `github.com/aymanbagabas/go-pty`（MIT）；其 `github.com/creack/pty`（MIT）和 `github.com/u-root/u-root`（BSD-3-Clause）许可原文保存在 Go 许可目录。
- 文件编码转换使用 `golang.org/x/text`，采用 BSD-3-Clause；LICENSE 与 PATENTS 原文保存在 Go 许可目录。
- 动态转发使用 `github.com/armon/go-socks5`，采用 MIT；SOCKS 协议解析复用该库，许可原文保存在 Go 许可目录。
- OpenSSH 配置解析使用 `github.com/kevinburke/ssh_config`，采用 MIT；许可原文保存在 Go 许可目录。
- Iron Remote Desktop 和 RDP 后端的 npm 包声明 `MIT OR Apache-2.0`。它们包含预构建 WASM，相关上游许可证已保存；发布前仍需核对该 WASM 所含 Rust 依赖及对应构建来源，不能把宿主包声明当作全部第三方声明。
- `use-composed-ref` 收集时的 npm 元数据声明 MIT，但现有许可材料未包含对应原文与完整版权声明。正式分发前需按收集清单版本从包或上游来源核对补齐。

许可文件收集覆盖生产依赖树，可能包含未进入最终 bundle 的依赖和模块中的额外声明。当前收集结果用于开发构建审阅，尚未完成正式发行审计。

上述清单与许可副本是收集时的材料，不会随依赖升级自动更新。依赖或 WASM 制品变化时，按锁文件、实际分发产物与上游来源核对清单、许可和待办；保留第三方许可原文，不将本文件的包声明概述当作完整审计结果。

macOS 应用包和其他平台安装包正式分发时，需随包携带本文件、项目 `LICENSE` 与适用的依赖许可原文。当前未发布安装包。

Windows 与 Linux 主程序内嵌本文件、项目许可和收集的依赖声明，可在“设置 → 关于 → 开源许可”读取。macOS 应用包另保留资源目录副本。新增 Markdown 更新日志展示使用 `react-markdown` 及其生产依赖，材料收集在前端许可目录。Wails 更新组件新增使用 `golang.org/x/mod`，采用 BSD-3-Clause，许可原文位于 Go 许可目录。

## 发行前待办

- 补齐 `@replit/codemirror-minimap@0.5.2` 与 `use-composed-ref@1.4.0` 的许可原文及完整版权依据。此次核对的上游仓库根目录仍未附许可证文件，不能据 npm 的 MIT 字段自行补写版权声明。
- 核对已锁定 RDP WASM 制品的准确源码和 Rust 依赖，补齐适用第三方声明。宿主 npm 包的双许可字段不能证明所有嵌入依赖已完成审计。
- 按当前锁文件和最终分发制品复核依赖收集清单，完成发行审计。此节清空前，标签发布工作流拒绝公开 Release；手动候选包构建可用于验收。
