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

生成器将 SVG 原文件写入 PPTX 媒体包，并使用 Office 2019+ 原生 `asvg:svgBlip` 关系引用。基础 `a:blip` 使用内置透明 PNG 维持 OOXML 图片结构，但不提供旧版 Office 的视觉降级；不得调用 `sips`、Quick Look 或其他操作系统转换器，不得把 SVG 栅格化。交付前必须验证 SVG content type、媒体文件和两条图片关系完整。

许可可能变化。每次从网络获取新图标时重新检查官方来源，不把本文件当永久法律结论。
