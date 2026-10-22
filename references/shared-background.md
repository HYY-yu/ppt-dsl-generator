# 整份 Deck 共享背景

模板包含 `@背景` 时读取。它是页面级图片槽位，适合需要整份 Deck 保持同一背景的模板；普通 `@图片-N` 继续使用既有逐页图片规则。

- 在 PowerPoint 选择窗格将页面级图片精确命名为 `@背景`；不带编号或范围，不放入 Group 或列表，不用于普通 shape。
- 编译后节点为 `kind: "background"`，key 按页内出现顺序生成，例如 `background_1`。始终读取 Manifest 中的真实 key。
- 背景由调用方选取或生成并保存为本地 PNG/JPEG，再确定性绑定；所有背景槽位必须使用解析后相同的绝对路径。不同页面传入不同文件，即使内容相同也不能通过校验。
- 内容草稿和 `deck-content.schema.json` 不包含背景路径。`--content-only` 拒绝主动填入背景字段，最终校验要求每个已选页面的背景槽位均已绑定。
- 最终输入接受字符串路径或 `{ "path": "/absolute/path/background.png" }`。不接受 SVG、GIF 或远程 URL。
- 生成器只读取一次背景并嵌入一份媒体，每个槽位创建独立 relationship 指向这份媒体；保持各自图片框几何并居中裁剪。普通图片关系不得被重定向。
- 生成失败应报错；不能静默使用模板原背景。清理器删除已失去引用的原背景媒体，保留母版、布局及其他节点仍引用的图片。

共享背景不属于内容模型的逐页装饰图候选。若由 Agent 生成背景，它仍计入既有每份 Deck 1–3 张 AI 图片总量限制；应避免文字，并沿用已确认的整体风格。Runtime 本身不调用生图 Provider。

示例仅解释字段，实际 key 来自 Manifest：

```json
{"templateId":"slide_001","nodes":{"background_1":{"path":"/absolute/path/background.png"}}}
```
