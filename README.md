# Cedar

Cedar 是面向 Agent 开发团队的实验与改进工具。它从项目资料中整理有证据支持的任务方向，帮助团队开始设计行为评测。

当前为 **v0.1.0 预览版**：项目资料 → 现有 coding agent 分析 → 任务覆盖图 → 引用校验 → HTML / Markdown 报告。任务覆盖图是接入入口；DSH 是首个目标运行时，实际运行适配、offline A/B 和自动改进循环尚未实现。

## 从一个链接开始

把下面这段话交给你正在使用的 coding agent，并替换项目路径：

```text
请读取并按这个 Cedar Skill 完成项目接入：
https://raw.githubusercontent.com/terryjiao/cedar/v0.1.0/skills/cedar-onboard/SKILL.md

目标项目：<项目的绝对路径>
请在项目目录之外创建新的输出目录，生成任务覆盖图和可阅读报告。
```

需要 coding agent 具备终端和本地文件访问能力，以及 Node.js 22.19+、npm。首次运行需要访问 GitHub Releases 和 npm registry。工具包会自动下载并缓存，在你的环境中运行；无需手动克隆 Cedar、构建 TypeScript 或全局安装。

语义分析使用你现有 coding agent 的模型。Cedar CLI 不调用模型 API，也不上传项目资料；宿主 coding agent 读取资料时仍使用它本身的数据处理方式。

## 工具如何运行

Skill 使用固定版本的预构建包。以下命令可以单独确认工具可用：

```sh
npm exec --yes --ignore-scripts --package="https://github.com/terryjiao/cedar/releases/download/v0.1.0/terryjiao-cedar-0.1.0.tgz" -- cedar --version
```

应输出 `0.1.0`。把最后的 `--version` 换成 `skill` 可以读取完整工作流，换成 `--help` 可以查看参数。请从目标项目以外的空目录运行命令，并使用绝对路径。源码和包版本固定在 [v0.1.0](https://github.com/terryjiao/cedar/releases/tag/v0.1.0)。

工作流包含三步，宿主 agent 会负责组织和执行：

1. `onboard <project> --out <new-bundle>`：收集有边界的资料快照，生成分析请求和 JSON Schema。
2. 宿主 agent 读取资料、生成 `coverage.json`，再用 `validate <coverage.json> --bundle <bundle>` 校验引用和结构。
3. `report <coverage.json> --bundle <bundle> --out <new-report>`：生成 `report.html` 和 `report.md`。HTML 可直接在浏览器打开。

以上命令都接在相同的 `npm exec … -- cedar` 前缀后。`onboard` 本身不会生成任务覆盖图；无需用户手写 JSON。

资料包包含 `sources.json`、`context.md`、`coverage.schema.json`、`request.md`、`dsh-readiness.json` 和完整 Skill 副本 `cedar-onboard.md`。所有输出目录必须是目标项目之外的新目录。

## 选择资料

默认最多收集 24 个文件、总计 256 KiB、每文件 64 KiB。Git 仓库使用 Git 文件清单并尊重 ignore；普通目录使用受限遍历。两种方式都排除依赖目录、构建输出、常见凭证文件名、二进制和符号链接。不会安装或执行目标代码。

自动选择只是起点。宿主 agent 应检查遗漏；缺少关键资料时，可以重复使用 `--include <relative-file>`，将明确选择的文件收集到新的 bundle。显式选择仍尊重 Git ignore，超限或无法读取会报错。`--max-files`、`--max-bytes` 和 `--max-file-bytes` 可以调整边界。

文件名排除不是内容级秘密扫描。请只提供允许宿主 agent 阅读的资料。快照记录原文和哈希；Git commit 仅供参考，工作区是否有修改标记为未知。收集过程不执行 Git status/diff，以避免触发目标仓库的过滤器。

## 如何理解报告

- `documented` / `inferred` 区分明确记录的任务与待确认的推断。
- `existing` / `proposed` 区分已有检查与建议检查；已有检查必须引用证据。
- `candidate` 只表示可以进入执行探针，不表示已经执行或通过。
- 校验器检查来源、哈希、行号、原文引用和状态一致性。语义是否成立仍需审阅。
- 任务数量不是覆盖率。测试源码存在不等于本次测试通过。DSH 静态检查始终标记为 `not-executed`。

## 开发

开发 Cedar 本身才需要克隆源码和构建：

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run test:package
```

`test:package` 从独立临时目录和全新 npm 缓存执行实际安装包，验证完整的合成接入流程以及目标文件未被修改。它验证分发与工具行为，不衡量模型生成的任务质量。

架构与边界见 [architecture](docs/architecture.md)，本地开发和版本发布见 [development](docs/development.md)。

后续功能见 [产品路线图](docs/roadmap.md)；当前要推进的工作见 [下一里程碑](docs/next-milestone.md)；已完成内容与验证依据见 [开发进度](docs/progress.md)。

## 许可证

[MIT](LICENSE)
