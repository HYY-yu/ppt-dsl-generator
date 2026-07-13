# 免费 SVG 图标来源

优先使用风格统一的单一图标库。下载 SVG 到任务本地缓存，再将绝对路径写入 `DeckInput`；不要让最终生成依赖远程 URL。

可优先选择：

- Lucide：<https://lucide.dev/>，ISC License，适合通用线性图标。
- Tabler Icons：<https://tabler.io/icons>，MIT License，图标覆盖面广。
- Heroicons：<https://github.com/tailwindlabs/heroicons>，MIT License，适合简洁 UI 图标。
- Phosphor Icons：<https://github.com/phosphor-icons/core>，MIT License，提供多种线宽和风格。
- Simple Icons：<https://simpleicons.org/>，仅用于品牌图标；项目为 CC0，但每个品牌图标仍可能涉及商标或单独许可，使用前查看对应图标说明。

## 选择与缓存规则

1. 根据页面语义检索 2–3 个候选图标。
2. 在同一页面和同一列表中保持库、线宽、填充方式一致。
3. 下载原始 SVG，保留 `viewBox`，删除脚本、外部资源和事件属性。
4. 保存到任务资产目录并记录来源 URL、图标名和许可。
5. 生成前验证 SVG 可解析且非空。
6. 网络失败时明确报错；不得悄悄保留模板样例图标。

PowerPoint 对只含 SVG relationship 的简化 OOXML 兼容性不稳定。生成器在 macOS 上必须通过 `sips` 将 SVG 栅格化为透明 PNG 后写入媒体包，确保桌面版 PowerPoint 可见；编译模板和本地缓存仍保留原始 SVG。不要使用 Quick Look 缩略图，它会产生不透明白底并保留 SVG 的小尺寸画布。其他运行环境应预先提供透明 PNG，不得写出未经验证的裸 SVG relationship。

许可可能变化。每次从网络获取新图标时重新检查官方来源，不把本文件当永久法律结论。
