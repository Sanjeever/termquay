# 第三方依赖声明

TermQuay 采用 Apache-2.0。各依赖保留其原有许可证、版权与声明。

- `go.mod`、`go.sum` 固定 Go 依赖版本。`build/licenses/go/modules.json` 记录 macOS、Windows 与 Linux 依赖解析结果，目录内保存相应模块附带的许可证、NOTICE 和版权文件。
- Go 工具链原始许可证保存在 `build/licenses/go/Go/LICENSE`。
- `frontend/pnpm-lock.yaml` 固定前端依赖。`build/licenses/frontend/packages.json` 记录生产依赖元数据，目录内保存包附带的许可文件。
- Wails 与前端运行时采用 MIT；React、HeroUI、xterm.js、CodeMirror 及大部分前端依赖采用 MIT。具体条款以各依赖原文为准。
- 终端搜索与链接使用 xterm 5.5 官方兼容的 `@xterm/addon-search` 0.15.0、`@xterm/addon-web-links` 0.11.0，均采用 MIT；许可原文随包保存在前端许可目录。
- 快速连接使用 `github.com/google/shlex` 解析引号与词法，采用 Apache-2.0；不执行解析内容。许可原文保存在 Go 许可目录。
- 文件冲突对比使用 `@codemirror/merge` 6.12.3，采用 MIT；许可原文保存在前端许可目录。
- 有界目录扫描使用 `github.com/pkg/sftp/v2` 2.0.0-alpha2 的分页目录 API，采用 BSD-2-Clause，许可原文保存在 Go 许可目录。该预发布模块限定用于扫描；文件传输继续使用已验证的 v1 模块，升级前需复核分页、取消与资源释放。
- Windows SSH Agent 命名管道使用 `github.com/Microsoft/go-winio` 0.6.2，采用 MIT；许可原文保存在 Go 许可目录。
- 动态转发使用 `github.com/armon/go-socks5`，采用 MIT；SOCKS 协议解析复用该库，许可原文保存在 Go 许可目录。
- OpenSSH 配置解析使用 `github.com/kevinburke/ssh_config` 1.6.0，采用 MIT；Include 由应用限定在用户明确选中文件范围，许可原文保存在 Go 许可目录。
- Iron Remote Desktop 0.11.0 和 RDP 后端 0.7.0 的 npm 包声明 `MIT OR Apache-2.0`。它们包含预构建 WASM，相关上游许可证已保存；发布前仍需核对该 WASM 所含 Rust 依赖及对应构建来源，不能把宿主包声明当作全部第三方声明。
- `use-composed-ref` 1.4.0 收集时的 npm 元数据声明 MIT，但现有许可材料未包含对应原文与完整版权声明。正式分发前需从该版本包或上游来源核对补齐。

许可文件收集覆盖生产依赖树，可能包含未进入最终 bundle 的依赖和模块中的额外声明。当前收集结果用于开发构建审阅，尚未完成正式发行审计。

上述清单与许可副本是收集时的材料，不会随依赖升级自动更新。依赖或 WASM 制品变化时，按锁文件、实际分发产物与上游来源核对清单、许可和待办；保留第三方许可原文，不将本文件的包声明概述当作完整审计结果。

macOS 应用包和其他平台安装包正式分发时，需随包携带本文件、项目 `LICENSE` 与适用的依赖许可原文。当前未发布安装包。
