# PPT 节点 DSL 生成器

<div align="center">
  <a href="https://www.youtube.com/watch?v=nc9QSwV8cKk">
    <img src="https://i.ytimg.com/vi/nc9QSwV8cKk/hqdefault.jpg" width="720" alt="PPT 节点 DSL 生成器教学视频">
  </a>
  <p>
    <strong>教学视频：快速上手 PPT 节点 DSL 生成器</strong><br>
    点击封面开始观看完整教程。
  </p>
</div>

把 PowerPoint 模板变成一个受约束的生成系统：在 PowerPoint 选择窗格中用 DSL 标记可编辑节点，编译出 Manifest，再用结构化 `DeckInput` 精确替换文本、图片、图标、序号和列表。

项目同时包含可安装的 Codex Skill 与独立的 Node.js/TypeScript 命令行工具。生成过程保留原模板页面、母版、布局和未标记节点，不重新绘制页面。

## 核心能力

- 编译选择窗格节点名与页面备注中的 DSL。
- 支持普通文本、图片、图标、序号和固定列表。
- 支持以 PowerPoint Group 为 Item 边界的定长和变长列表；首组不声明范围时保持定长，声明范围时允许增删 Item。
- 保留 Group 的交错布局合同，并统一同一列表中的图标槽位尺寸。
- 光栅图片按真实宽高居中裁剪填充；SVG 以 Office 2019+ 原生单关系写入。
- 生成 `template-manifest.json`、内容草稿 Schema、完整输入 Schema、Lint 报告与模板 SHA-256 锁文件。
- 支持“纯内容草稿校验 → 绑定图片与图标 → 自动补齐序号并执行完整输入校验”的两阶段填充流程。
- 大纲章节数先由目录模板容量与默认 3-6 章求交确定；仅提供主题时，Agent 根据事实性和时效性自主选择检索资料或使用通用知识。
- 将模板示例文案作为字段语义提示写入 Manifest 与 Schema，不把示例文案当作生成内容或长度合同。
- 生成前校验页面类型、字段、可见文本长度、列表容量和目录/章节合同。
- 生成后清理备注、DSL 节点名、未引用页面与媒体、悬空动画和无效关系，并规范化 relationship ID。
- 对重复页面和 Group 重新分配唯一 creationId，避免 PowerPoint 修复提示。
- 异常不会静默跳过：模板解析、输入越界、资源缺失和关系损坏都会返回非零退出码。

## 环境要求

- Node.js 20 或更高版本
- npm
- PowerPoint 2019、PowerPoint 2021 或 Microsoft 365（用于制作带 DSL 标记的模板）
- SVG 使用 Office 2019+ 原生 `asvg:svgBlip` 单关系写入 PPTX，不生成 fallback、不进行栅格化

项目不依赖 Microsoft PowerPoint 编译、生成或执行程序性验证。

原生 SVG 输出仅支持 PowerPoint 2019 及以上版本，不为旧版 Office 生成兼容图像。

## 仓库结构

```text
.
├── SKILL.md                         # Codex Skill 入口
├── agents/openai.yaml               # Skill 展示信息与默认提示词
├── assets/ppt-node-dsl-project/     # Node.js/TypeScript 编译与生成工具
├── examples/
│   ├── README.md                    # 可运行示例说明
│   ├── ppt_example.pptx             # 节点 DSL 学习模板
│   ├── deck-content.example.json    # 仅包含文案与列表的内容草稿
│   ├── deck-input.example.json      # 与示例模板匹配的输入
│   └── 模板节点DSL标记指南.md
└── references/                      # DSL、输入映射与 Gate 规范
```

## 快速开始

```bash
git clone https://github.com/HYY-yu/ppt-dsl-generator.git
cd ppt-dsl-generator/assets/ppt-node-dsl-project
npm ci
npm run check
npm test
```

编译自己的模板：

```bash
TEMPLATE="/绝对路径/your-template.pptx"
COMPILED_DIR="/绝对路径/compiled-template"

npm run compile-template -- \
  --template "$TEMPLATE" \
  --out "$COMPILED_DIR"
```

编译成功后会产生：

- `template.pptx`
- `template-manifest.json`
- `deck-content.schema.json`
- `input.schema.json`
- `template-lint.json`
- `template.lock.json`

先校验仅包含文案与列表的内容草稿：

```bash
DECK_CONTENT_DRAFT="/绝对路径/deck-content.json"

npm run validate-input -- \
  --manifest "$COMPILED_DIR/template-manifest.json" \
  --input "$DECK_CONTENT_DRAFT" \
  --content-only
```

`--content-only` 仍校验整套页面结构、章节数量、列表容量和文本长度，并拒绝草稿主动携带序号、图片或图标。

再绑定图片和图标，并校验完整 `DeckInput`。页面级与列表级序号都可以继续省略，CLI 会在完整校验前确定性补齐：

```bash
DECK_INPUT="/绝对路径/deck-input.json"

npm run validate-input -- \
  --manifest "$COMPILED_DIR/template-manifest.json" \
  --input "$DECK_INPUT"
```

生成并验证 PPTX：

```bash
OUTPUT_PPTX="/绝对路径/output.pptx"

npm run generate -- \
  --template "$COMPILED_DIR/template.pptx" \
  --manifest "$COMPILED_DIR/template-manifest.json" \
  --input "$DECK_INPUT" \
  --out "$OUTPUT_PPTX"

npm run verify -- --pptx "$OUTPUT_PPTX"
```

完整的公开示例命令见 [`examples/README.md`](examples/README.md)。`examples/ppt_example.pptx` 仅用于学习和测试；生成实际演示文稿时必须使用你自己的模板路径。

## 节点 DSL 示例

普通节点：

```text
@文本[4-18]
@图片-1
@图标
@序号-01
```

固定列表：

```text
@1@1 文本[4-10]
@1@1 序号-01
@1@2 文本
@1@2 序号
```

Group 定长列表将每个完整 Item 制作为 PowerPoint Group，不声明范围：

```text
@1@1
@1@2
@1@3
```

需要允许 Item 数变化时，只在第一组声明范围：

```text
@1@1[3-5]
@1@2
@1@3
```

完整语法见 [`references/node-dsl-spec.md`](references/node-dsl-spec.md)，模板制作步骤见 [`examples/模板节点DSL标记指南.md`](examples/模板节点DSL标记指南.md)。

## 作为 Codex Skill 安装

将仓库克隆到 `$CODEX_HOME/skills/ppt-node-dsl-generator`。未设置 `CODEX_HOME` 时，默认目录为 `~/.codex/skills`：

```bash
git clone https://github.com/HYY-yu/ppt-dsl-generator.git \
  ~/.codex/skills/ppt-node-dsl-generator
```

重新打开 Codex 任务后，使用：

```text
$ppt-node-dsl-generator
```

Skill 会按“编译模板 → 按目录容量确认大纲 → 选择模板页 → 校验内容草稿 → 绑定图片与图标 → 自动补齐序号并校验完整 DeckInput → 生成 PPTX → 程序性验证”的流程工作。

## 文档导航

- [`SKILL.md`](SKILL.md)：完整工作流和硬性边界
- [`references/node-dsl-spec.md`](references/node-dsl-spec.md)：节点、Group 定长/变长列表、页面备注和继承规则
- [`references/deck-input.md`](references/deck-input.md)：Manifest 到 `DeckInput` 的映射规则
- [`references/deck-fill-workflow.md`](references/deck-fill-workflow.md)：内容草稿、序号和资产的两阶段填充流程
- [`references/image-generation.md`](references/image-generation.md)：AI 生图预算、风格、构图和填充规则
- [`references/programmatic-gates.md`](references/programmatic-gates.md)：编译、输入和输出 Gate
- [`references/outline-workflow.md`](references/outline-workflow.md)：大纲生成与确认边界
- [`references/icon-sources.md`](references/icon-sources.md)：图标来源、缓存与许可记录

## 开发与测试

```bash
cd assets/ppt-node-dsl-project
npm ci
npm run check
npm test
```

## 安全与隐私

工具在本地读取模板、输入和资产，不会主动上传文件。模板和生成内容仍可能包含敏感信息，请在提交或分享前自行检查。图标等第三方素材需遵守各自许可证和商标规则。

## 许可证

本项目使用 [MIT License](LICENSE)。第三方依赖及示例中引用的外部素材仍适用各自许可证。

---

<div align="center">
  <h2>从文章到 PPT，只需一步</h2>
  <p>
    此开源项目已经被集成到 <strong>JoyfulWords</strong>，可以一键把文章转成 PPT。
  </p>
  <p>
    <a href="https://joyword.link"><strong>前往 JoyfulWords，开始创作 →</strong></a>
  </p>
</div>
