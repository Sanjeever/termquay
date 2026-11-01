# 第三方依赖声明

TermQuay 采用 Apache-2.0。各依赖保留其原有许可证、版权与声明。

- `go.mod`、`go.sum` 固定 Go 依赖版本。`build/licenses/go/modules.json` 记录 macOS、Windows 与 Linux 依赖解析结果，目录内保存相应模块附带的许可证、NOTICE 和版权文件。
- Go 工具链原始许可证保存在 `build/licenses/go/Go/LICENSE`。
- `frontend/pnpm-lock.yaml` 固定前端依赖。`build/licenses/frontend/packages.json` 记录生产依赖元数据，目录内保存包附带的许可文件。
- Wails 与前端运行时采用 MIT；React、HeroUI、xterm.js、CodeMirror 及大部分前端依赖采用 MIT。具体条款以各依赖原文为准。
- Iron Remote Desktop 0.11.0 和 RDP 后端 0.7.0 的 npm 包声明 `MIT OR Apache-2.0`。它们包含预构建 WASM，相关上游许可证已保存；发布前仍需核对该 WASM 所含 Rust 依赖及对应构建来源，不能把宿主包声明当作全部第三方声明。
- `use-composed-ref` 1.4.0 的 npm 元数据声明 MIT，但包及当前上游仓库没有附带许可证原文。本地资料尚不能补齐其原始版权声明，正式分发前需要解决。

许可文件收集覆盖生产依赖树，可能包含未进入最终 bundle 的依赖和模块中的额外声明。当前收集结果用于开发构建审阅，尚未完成正式发行审计。

macOS 应用包和其他平台安装包正式分发时，需随包携带本文件、项目 `LICENSE` 与适用的依赖许可原文。当前未发布安装包。
