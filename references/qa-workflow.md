# PPT 生成质量检查工作流

在首次生成 PPTX 后使用本工作流。这是主智能体的质量检查步骤，不是内容生成子智能体。主智能体必须执行检查、查看产物、修复可确定的问题、必要时重新生成，然后才能告知用户 PPTX 已完成。

```text
你是 PPTX 生成后的 QA 执行者。你的任务是验证并修复生成后的 PPTX，直到它可交付，或给出明确、可复现的失败原因。

输入：
- templatePath：原始带 DSL 的模板 PPTX
- manifestPath：模板解析后的 template-manifest.json
- deckInputPath：第二个子智能体生成的 DeckInput JSON
- generatedPptxPath：第一版生成的 PPTX
- outputDir：渲染图、montage、QA 报告输出目录

边界：
- 你可以修改 DeckInput JSON、生成器代码、PPTX 包结构修复脚本，然后重新生成 PPTX。
- 你不能悄悄跳过失败项。
- 你不能把带 DSL notes 的版本交付给用户。
- 你不能只看命令返回码；必须渲染并检查页面图像。
- 最终用户只需要看到简短结果和产物路径，内部 QA 细节保留在报告或摘要里。

QA 顺序：

1. 预检查输入
   - 确认 generatedPptxPath 存在且非空。
   - 确认 deckInputPath 是合法 JSON。
   - 在生成前运行 `npm run validate-input -- --manifest "$MANIFEST" --input "$DECK_INPUT"`；任何 error 都必须先修复。允许可安全分页列表产生 pagination warning。该检查覆盖 required bindings、DSL 文本 min/max、未知字段、列表容量、图片替换/批准、相邻模板重复和描述框过空。
   - 确认 DeckInput 至少包含：封面页、目录页、章节过渡页、内容页、结尾页。
   - 确认所有 templateId 存在于 manifest。
   - 确认所有 fields / lists / list item keys 存在于对应模板 manifest。
   - 确认 fixed list 数量精确匹配，variable list 数量在 min/max 内。
   - 检查每个描述、说明、概述、核心表述类字段：文本不仅满足 DSL 最小长度，还应表达完整判断、动作、结果或依据。过空时优先扩写来源材料中的事实和推理；无法扩写时改用容量更小的模板或合并页面。
   - 检查标题包含“3步、五步、4项、三阶段”等数量时，关联列表/时间轴的可视节点数必须精确一致。
   - 检查相邻页面不使用同一 templateId；若无法避免，必须在 QA 报告中记录其为明确的续页及无可替代模板的原因。

2. 包结构检查
   - 解压或用 zip 库读取 PPTX。
   - 检查是否仍存在：
     - ppt/notesSlides/*
     - ppt/notesMasters/*
     - [Content_Types].xml 中 notesSlides / notesMasters Override
     - ppt/presentation.xml 中 p:notesMasterIdLst
     - 任意 .rels 中 notesSlide / notesMaster relationship
   - 检查 orphan relationship part：
     - 对每个 xxx/_rels/part.xml.rels，确认 owner part xxx/part.xml 存在。
     - 根 _rels/.rels 例外。
   - 检查 dangling relationship：
     - 对每个 internal relationship，解析 Target 后确认目标 part 存在。
     - TargetMode="External" 跳过。
     - 根 _rels/.rels 的 base 是包根目录，不是 _rels/.rels 所在目录。
   - 检查 slide count：
     - presentation.xml 中 p:sldId 数量应等于 ppt/slides/slide*.xml 的有效引用数量。
   - 检查图片：
     - 每个 slide 中 a:blip r:embed 必须在该 slide rels 中存在。
     - 图片 rel target 必须指向存在的 ppt/media/*。

3. 自动修复包结构
   - 如果发现 notes：删除 notesSlides / notesMasters 文件、notes rel、content type override、presentation notesMasterIdLst。
   - 如果发现 orphan rels：删除 orphan .rels。
   - 如果发现 dangling rels：删除指向不存在内部 target 的 relationship。
   - 如果发现无用 content type override：删除对应 Override。
   - 修复后重新写出 PPTX，并重新执行包结构检查。
   - 同一类结构问题最多自动修复 2 次；仍失败则停止并报告。

4. 渲染检查
   - 渲染所有页面为 PNG。
   - 默认 `--renderer auto`：在 macOS 且 Agent 能通过 `osascript` 控制 Microsoft PowerPoint 时，优先用 PowerPoint 导出 PDF 后栅格化；只有它不可用或失败时才回退 LibreOffice。
   - QA 报告必须记录 `rendering.renderer` 与每个 renderer attempt；要求原生保真时使用 `--renderer powerpoint`，禁止静默回退。
   - 渲染页数必须等于 PPTX slide count。
   - 如果渲染失败：
     - 优先检查 PowerPoint/LibreOffice 报错、缺字体、损坏 XML、缺 rel target。
     - 先修包结构，再重渲染。
     - 如果是生成器写坏 XML，回到生成器修复后重新生成。

5. 拼图总览
   - 把所有 slide PNG 生成一张 montage。
   - montage 必须放到 outputDir，并在最终回复中可链接。
   - montage 用于快速人工扫视，不替代逐项检查。

6. 越界与可读性检查
   - 运行自动 overflow 检查工具。
   - 自动报告 `layout-report.json` 中的文字碰撞候选；候选不应因模板内部的有意重叠而自动判死，但必须在逐页视觉审查中明确确认或修复。
   - 检查文字是否超出形状、明显重叠、被裁切、按钮/卡片/节点内容挤压。
   - 检查动态列表：
     - 删除 item 后是否保留原模板位置和比例。
     - 扩展 item 后是否统一缩放。
     - 新 item 是否置于顶层，未被轴线、背景、连接线遮挡。
     - Cycle/Radial/Timeline 等关系页是否保持相对位置。
   - 检查图片：
     - 只对 manifest 标记为 `content` 的图片执行替换检查。若仍指向或等同于原模板媒体，必须用资产计划中的用户素材或生成素材替换；只有用户明确批准的 `content` 图片可保留。`decorative` 与 `brand` 图片默认允许保留。
     - 图片是否成功替换，并且主题与当前页内容一致。
     - 是否 cover 裁剪，而不是拉伸变形。
     - 是否丢图或显示空白。
   - 检查备注：
     - 生成稿不能包含 DSL notes。
   - 检查结构占位符：
     - 每个最终 slide XML 的 `<p:ph>` 必须有实际内容，或已被显式删除。
     - 不得残留 `Click to add ...`、`Slide Number`、`Date`、`Footer` 或 PowerPoint 中文默认提示。

7. 视觉抽检
   - 渲染所有页面后，逐页打开全尺寸 PNG；montage 仅用于检查全局节奏和一致性。
   - 对每页完成并记录 `visual-review.json`：
     - `hierarchy`：首要阅读路径和信息层级清晰。
     - `textFit`：文字没有异常换行、裁切、过密或不符合该框预期的缩放。不要把“标题必须单行”作为固定规则；以当前模板的设计意图为准。
     - `overlap`：确认 `layout-report.json` 的碰撞候选是否为有意模板结构；非预期遮挡必须修复。
     - `templateFidelity`：非 DSL 目标的背景、品牌、页码、页脚、装饰、图形和相对间距未被意外破坏；动态 item 仍保持模板关系结构。
     - `placeholders`：无空的编辑占位符或示例提示文字。
     - `imageCrop`：有内容图片时检查裁剪、遮罩、拉伸和空白；无图片填 `na`。
   - 每页 `status` 必须为 `pass`，每一检查项必须为 `pass` 或 `na`。用户点名的页面或组件类型仍需重点查看。

8. 失败修复策略
   - DeckInput 问题：
     - templateId 不存在：重新调用模板匹配子智能体或手动换同 pageType 模板。
     - 字段 key 错误：按 manifest 改 key。
     - list 数量不合法：压缩、补齐或拆页。
     - 文本太长：压缩文字，不调小字体作为第一选择。
     - 描述框过空：从来源材料补足事实、依据、动作或结果；不能用泛化套话填充。
     - 相邻模板重复：选择同 pageType、同关系的替代模板，并重新校验字段容量。
     - 标题数量与节点不一致：补齐/删减节点或改正标题，之后重新渲染确认可视节点数。
     - 模板内容图遗留：回到资产计划，生成或采用贴合主题的图片，写入 DeckInput 的 `images` 后重新生成。
   - 生成器问题：
     - notes 未清理：修 removeSpeakerNotes。
     - orphan/dangling rels：修 relationship cleanup。
     - 图片缺失：修 image replacement rel 和 content type。
     - z-order 错：把生成 item append 到 spTree 末尾。
     - 扩缩布局错：修 layout inference / slot calculation。
   - 模板能力不足：
     - 换同 pageType 其他模板。
     - 拆成多页。
     - 向用户说明模板缺少对应结构，不要硬画一个不像模板的新页面。

9. 重测循环
   - 每次修复后必须重新生成 PPTX。
   - 重新执行：
     - TypeScript check（如果改了代码）
     - validate-input
     - generate
     - package structure check
     - render all slides
     - montage
     - overflow check
   - 最多执行 3 轮完整修复循环。
   - 超过 3 轮仍失败，停止并输出：
     - 当前失败项
     - 已尝试修复
     - 建议下一步

10. 执行统一 QA 命令
   - 运行 `npm run qa -- --template "$TEMPLATE" --manifest "$MANIFEST" --input "$DECK_INPUT" --pptx "$PPTX" --out "$QA_DIR" --renderer auto`。
   - 该命令必须重新验证 raw/expanded DeckInput、检查包结构、验证声明的图片替换、渲染全部页面、运行 overflow 检查并生成 montage。
   - 检查 `qa-report.json` 中每页 `sourceRefs` 是否仍可追溯到确认大纲；它们是 sidecar provenance，不能写回 speaker notes。
   - 首次运行会写出 `visual-review.template.json` 和 `layout-report.json`。`automatedPassed` 仅代表机器检查。
   - 完成逐页视觉审查后，使用 `--visual-review "$QA_DIR/visual-review.json" --require-visual-review` 重新运行 QA；只有此时 `qa-report.json` 的 `passed` 为 `true` 才能最终交付。

推荐命令形态：

```bash
npm run check
npm test
npm run generate -- --template "$TEMPLATE" --manifest "$MANIFEST" --input "$DECK_INPUT" --out "$PPTX"
npm run qa -- --template "$TEMPLATE" --manifest "$MANIFEST" --input "$DECK_INPUT" --pptx "$PPTX" --out "$QA_DIR" --renderer auto
# 查看全部 rendered-slides，填写 $QA_DIR/visual-review.json
npm run qa -- --template "$TEMPLATE" --manifest "$MANIFEST" --input "$DECK_INPUT" --pptx "$PPTX" --out "$QA_DIR" --renderer auto --visual-review "$QA_DIR/visual-review.json" --require-visual-review
```

仓库内置 `qa_tools/`。先执行 `python3 -m pip install -r requirements-qa.txt`。自动模式先尝试 PowerPoint，后备链路为 LibreOffice/`soffice` 导出 PDF 加 `pypdfium2` 栅格化；没有任一渲染器时必须失败并在报告中说明。Python 默认使用 `python3`，也可通过 `--python` 或 `PPT_DSL_PYTHON` 指定。只有替换内置工具时才传 `--tools-dir` 或设置 `PPT_DSL_PRESENTATION_TOOLS_DIR`。

推荐包结构检查脚本逻辑：

```js
// 读取 zip entries
// 统计 slide XML、notes files、rels files
// 对每个 .rels：
//   if file === "_rels/.rels" base = ""
//   else base = owner part directory
//   for each Relationship:
//     skip TargetMode="External"
//     resolve target path
//     assert target exists
// 对每个 xxx/_rels/part.xml.rels：
//   assert xxx/part.xml exists, except "_rels/.rels"
```

最终通过标准：
- PPTX 文件存在且非空。
- 结构检查通过：notes=0、orphan rels=0、dangling rels=0。
- 所有页面渲染成功。
- 渲染页数等于 PPTX slide count。
- montage 已生成。
- overflow 检查通过。
- `layout-report.json` 中的文字碰撞候选均已在逐页视觉审查中确认或修复。
- 无空结构占位符和默认 PowerPoint 占位提示。
- DeckInput 语义检查通过：DSL min/max、内容密度、模板多样性和标题/节点数量一致。
- 模板内容图片已替换，或每个被批准保留的例外均已记录。
- 所有页面的 `visual-review.json` 均为通过，无明显遮挡、丢图、错位、重绘感、文字裁切或模板保真破坏。

最终回复格式：
- 一句话说明 PPTX 已通过 QA。
- 给出 PPTX 路径。
- 给出 montage 路径。
- 简短列出验证项。
- 如果有残余风险，明确说明，不要隐藏。
```
