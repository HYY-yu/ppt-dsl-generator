---
name: ppt-dsl-generator
description: 基于演讲者备注中的自定义 DSL 和 PPTX 模板，从用户文档生成 PowerPoint 演示文稿。适用于用户提供或要求使用带 DSL 标记的 PPT 模板、需要将模板解析为可复用 manifest/schema，或需要将 PDF、Word、Markdown、文本等源材料经过模板工作流生成并完成 QA 的 PPTX。
---

# PPT DSL 模板生成器

使用本 Skill 执行完整的模板驱动 PPTX 工作流：

1. 将带 DSL 标记的模板 PPTX 解析为可复用的 Node 项目输出。
2. 从用户资料生成 PPTX 前，必须先取得模板。
3. 将源资料整理为由用户确认的 PPT 大纲。
4. 将确认后的大纲转换为受模板约束的 `DeckInput` JSON。
5. 生成 PPTX，并完成 QA、修复与重试。
6. 仅在 QA 通过后交付最终 PPTX 与 montage。

## 资源

- `assets/ppt-template-dsl-project/`：可复用的 Node/TypeScript 项目骨架，用 `pptx-automizer` 分析 DSL 模板并生成演示文稿。
- `references/outline-subagent.md`：从任意资料产出待确认 PPT 大纲的提示词。
- `references/template-match-subagent.md`：选择模板页并编写 `DeckInput` JSON 的提示词。
- `references/qa-workflow.md`：主智能体 QA 工作流，涵盖输入语义、包检查、渲染、montage、越界检查、修复和复测。
- `references/dsl-spec.md`：DSL 语法、图片角色和模板编写规则。
- `references/asset-plan.md`：生成 `DeckInput` 前的主智能体图片资产规划步骤。
- `docs/DOCS.md`：面向模板作者的 DSL 教程；`docs/ppt_example.pptx` 提供带备注的可学习示例。

仅在进入相应步骤时读取对应参考资料；除非任务需要完整工作流，否则不要预先加载所有参考资料。

## 工作流

### 1. 模板接收与解析

用户提供带 DSL 备注的 PPTX 模板时，创建或复用一个工作中的 Node 项目：

- 若当前工作区已有生成器项目，直接使用。
- 否则将 `assets/ppt-template-dsl-project/` 复制到任务工作区。
- 缺少依赖时运行 `npm ci`。
- 执行模板分析：

```bash
npm run analyze -- --template "$TEMPLATE_PPTX" --out "$OUTPUT_DIR"
```

预期解析输出：

- `template-manifest.json`
- `input.schema.json`
- `template-lint.json`

将 manifest/schema 作为后续大纲映射的稳定契约。生成的 PPTX 不得暴露 DSL 备注。
将分析失败视为模板编写问题：当模板缺少 DSL 页面类型或必要页面类型覆盖时，分析器必须拒绝输出不可用 manifest。
准备或排查模板时读取 `references/dsl-spec.md`。模板发生任何变更后必须重新分析；生成阶段会校验 manifest 中的模板 SHA-256 指纹。

### 2. 生成请求门禁

用户要求从任意资料生成 PPTX 时：

- 没有带 DSL 标记的 PPTX 模板或已解析的 `template-manifest.json` 时，停止并要求用户先提供模板 PPTX。
- 已有解析好的模板时，继续生成大纲。
- 用户提供的是普通、无 DSL 备注的 PPTX 时，说明本 Skill 需要先在演讲者备注中添加 DSL 标注，才能可靠自动化该模板。

### 3. 大纲确认循环

读取 `references/outline-subagent.md`。

用它将用户资料转化为待确认 PPT 大纲。若子智能体工具可用且当前工具策略允许委派，则将该提示词与资料上下文交给工作子智能体；否则由主智能体在本地完成同一职责。

主智能体负责用户交互：

- 展示大纲。
- 询问用户确认或修改。
- 持续迭代，直到用户确认大纲可用。
- 确认前不得选择模板页或编写 `DeckInput`。

确认后的大纲应为每页包含页面类型、标题、核心信息、内容要点、关系提示、视觉提示和来源引用。

### 4. 图片资产规划

选定页面需要内容图片时，读取 `references/asset-plan.md`，并在编写 `DeckInput` 前准备本地资产路径。除非用户明确要求替换，否则保持装饰图和品牌图不变。

### 5. 模板匹配与 DeckInput

读取 `references/template-match-subagent.md`。

使用确认的大纲、`template-manifest.json` 和 `input.schema.json` 生成 `DeckInput` JSON：

```json
{
  "title": "演示文稿标题",
  "slides": [
    {
      "templateId": "slide_002",
      "fields": {},
      "lists": {},
      "images": {},
      "approvedTemplateImages": [],
      "sourceRefs": []
    }
  ]
}
```

硬性规则：

- `templateId` 必须存在于 manifest。
- `fields`、`lists`、图片键和列表项键必须来自所选模板的 manifest。
- 页面类型必须匹配：封面对应封面、目录对应目录、内容对应内容、过渡对应过渡、结尾对应结尾。
- 固定长度列表必须精确匹配。
- DSL 最大值以内的可变列表必须在单页展示；只有生成器确认可安全分页时，才允许更大的原始列表。分页后每页都必须满足 DSL 最小值和最大值。
- 内容超过模板容量且不支持安全分页时，先拆成多个 `DeckInput` 页面。
- 编写符合 DSL 长度范围、能放入版面的实质文案；不得机械截断，也不得让说明类字段在视觉上为空。
- 不得交付模板自带的内容图片。必须使用用户提供资产，或用 `imagegen` Skill 生成特定内容的替换图，再将本地路径写入 `images`。仅当用户明确批准保留某一图片时，才能将该键写入 `approvedTemplateImages`。
- 避免相邻页面复用同一 `templateId`。在保持页面类型与关系契合的前提下，优先使用更丰富的模板组合。

生成前运行语义校验：

```bash
npm run validate-input -- --manifest "$MANIFEST_JSON" --input "$DECK_INPUT_JSON"
```

生成前修复每个报错。只有生成器可安全拆分列表时，允许出现分页警告。校验器会检查必填绑定、DSL 最小值/最大值、空洞或信息薄弱的说明文本、图片替换或批准、相邻重复模板、列表容量，以及标题中“第五步”等数量词与对应列表长度是否一致。

### 6. 生成 PPTX

使用选定的 `DeckInput` 运行生成：

```bash
npm run generate -- --template "$TEMPLATE_PPTX" --manifest "$MANIFEST_JSON" --input "$DECK_INPUT_JSON" --out "$OUTPUT_PPTX"
```

生成器应当：

- 通过 `pptx-automizer` 复用原模板页面。
- 按 manifest 锚点替换文本。
- 按 manifest 图片目标替换图片。
- 扩展、收缩并拆分页支持的列表页。
- 交付前移除演讲者备注。
- 清理孤立和悬空关系。

生成会再次执行原始输入校验，扩展可安全溢出的列表，改写含数量的续页标题，并在写出 PPTX 前校验展开后的 `DeckInput`。不得绕过生成阶段的校验失败。

若因 `DeckInput` 违反 schema 或 manifest 约束而失败，先修复 `DeckInput`。若因生成器处理 XML/布局错误而失败，修复生成器后重试。

### 7. QA、修复与交付

读取 `references/qa-workflow.md`。

报告成功前必须执行完整 QA。最低检查项：

- 生成的 PPTX 存在且非空。
- 生成前的 `DeckInput` 语义校验通过。
- 备注已移除：不存在 `ppt/notesSlides/*`、`ppt/notesMasters/*`、备注关系或备注内容类型覆盖。
- 已移除孤立关系部件。
- 已移除悬空的内部关系。
- 所有页面均可渲染为 PNG。
- 渲染页数与 PPTX 页数一致。
- 已生成 montage。
- 越界检查通过。
- 不存在空的结构占位符或残留的 PowerPoint 默认占位文本。
- 每页已完成全尺寸视觉审查：层级、文本适配、遮挡候选、图片裁剪（如有）、模板保真和占位符均有明确结果。
- 模板自带内容图已替换为用户提供或生成的资产，除非用户明确批准保留该特定资产。
- 未经明确的续页理由，相邻页不得复用同一模板；含数量的标题必须与可视列表节点数量一致。
- 封面、目录、动态列表页、图片页和结尾页均通过视觉抽检。

先执行自动 QA；该步骤会生成 `visual-review.template.json`：

```bash
npm run qa -- \
  --template "$TEMPLATE_PPTX" \
  --manifest "$MANIFEST_JSON" \
  --input "$DECK_INPUT_JSON" \
  --pptx "$OUTPUT_PPTX" \
  --out "$QA_OUTPUT_DIR" \
  --renderer auto
```

然后逐页打开全尺寸 PNG。montage 只能用于检查全局节奏，不能代替逐页检查。将模板复制为 `visual-review.json`，为每页填写 `hierarchy`、`textFit`、`overlap`、`templateFidelity`、`placeholders` 和 `imageCrop`（无图片时可填 `na`）；再执行最终 gate：

```bash
npm run qa -- \
  --template "$TEMPLATE_PPTX" \
  --manifest "$MANIFEST_JSON" \
  --input "$DECK_INPUT_JSON" \
  --pptx "$OUTPUT_PPTX" \
  --out "$QA_OUTPUT_DIR" \
  --renderer auto \
  --visual-review "$QA_OUTPUT_DIR/visual-review.json" \
  --require-visual-review
```

只有最终 `qa-report.json` 的 `passed: true` 才能交付；`automatedPassed: true` 只表示机器检查通过。QA 不强制标题单行；审查的是文字是否符合当前模板框和预期层级，必要时缩写文案、换模板或拆页。
视觉 QA 前安装 `assets/ppt-template-dsl-project/requirements-qa.txt`。`auto` 必须先尝试由 `osascript` 可控制的 macOS Microsoft PowerPoint，并在 `qa-report.json` 记录实际 renderer；只有原生渲染不可用或失败时才回退到内置 LibreOffice/Python 链路。原生保真度为硬要求时使用 `--renderer powerpoint`；需要跳过 PowerPoint 时使用 `--renderer fallback`。不得依赖 Codex 运行时私有路径。

QA 失败时：

- 直接修复可确定的包结构问题。
- 通过修改模板选择、列表数量或文案长度修复 `DeckInput` 问题。
- 布局、层级、图片或关系清理存在问题时，修复生成器代码。
- 重新生成，并重新运行全部 QA 检查。
- 最多执行三轮完整修复；仍失败时，带证据报告剩余问题。

仅在 QA 通过后才告知用户 PPTX 已完成。回复中提供最终 PPTX 与 montage 链接。

## 实现说明

- 优先保留模板原有形状。除非模板没有可用结构，否则不得从零重画页面。
- 将 DSL 长度范围视为布局约束，而非建议。
- 保持 DSL 备注仅供内部使用；最终 PPTX 用户不应看到它们。
- 动态项目必须保持单项内的相对几何关系。必要时，将生成的项目块追加到 `p:spTree` 的足够靠后位置，确保其位于坐标轴或正文形状之上。
- 原生 SmartArt、分组 `p:grpSp` 或复杂自由曲线路径等不受支持的结构，应选择更安全的模板或说明限制，不能产出失真的页面。
