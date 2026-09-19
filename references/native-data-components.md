# 原生表格、图表与配色合同

编译、填充或调试含数据组件的模板时读取。实现位于 `assets/ppt-node-dsl-project/src/pptx/data-components.ts`；JSON Schema 与 runtime 校验共同约束输入。不要将业务服务的中间 JSON 当成最终 DeckInput。

## 标记与容量

在 PowerPoint 选择窗格中将**原生表格整个对象**命名为 `@表格`，将**原生图表整个对象**命名为 `@图表`。规范写法不含空格，不附带序号或 `[范围]`；容量从 OOXML 原生数据读取，不以文本长度 DSL 指定。截图、文本框拼表、图片图表不符合此合同。

- 编译器必须枚举 `p:graphicFrame`，不能只遍历 `p:sp/p:pic/p:grpSp`。编译后按出现顺序得到 `table_1`、`chart_1` 等 key，定位仍使用 shapeId。
- 数据组件仅支持页面级节点；不能放入 Group Item、固定列表或嵌套组合。遇到不支持的标记/结构必须报错，不能静默漏编译。
- 表格至少有一行表头和一行数据，不支持合并单元格。列数固定；`minRows=1`，`maxRows=模板行数-1`，行数不包含表头。
- 图表当前支持单一 `bar`（柱/条）、`line`（折线）、`doughnut`（圆环）；不支持组合图、饼图、散点图等其他类型。系列数固定；分类数从 1 到模板缓存分类数。各系列分类容量必须一致。
- 图表必须关联内部可编辑 XLSX 工作簿；只有缓存或外部 Excel 链接不能通过编译检查。常规单数据工作表模板是本版本支持的准备方式，复杂工作簿应在模板准备阶段简化并独立验收。
- 当前编译器的单元格、分类和系列名称 `maxTextLength` 默认 24 个 Unicode 码点；这不是所有设计的视觉保证。实际输入始终读取 Manifest；更窄的模板应调整合同并重新验收。

Manifest 示例（省略 locator 等运行时必需字段，仅解释容量）：

```json
{
  "kind": "table",
  "table": { "columns": 4, "minRows": 1, "maxRows": 5, "maxTextLength": 24 }
}
```

```json
{
  "kind": "chart",
  "chart": { "type": "line", "series": 2, "minCategories": 1, "maxCategories": 5, "maxTextLength": 24 }
}
```

示例容量不作为默认值：必须由用户当前模板重新编译得到。

## 模型内容与最终输入

`deck-content.schema.json` 与 `--content-only` 允许页面级文本、表格数据、图表数据和列表文本；序号、图片/图标路径以及 `palette` 仍由确定性流程绑定。富文本既有合同保持不变；表格单元格和图表标签只接受短字符串。

下面是两个独立节点的填充值示例，不是完整 Deck。模板必须分别具备匹配的列数、系列数与容量：

```json
{
  "table_1": {
    "headers": ["指标", "优化前", "优化后", "单位"],
    "rows": [["P95响应耗时", "940", "410", "毫秒"]]
  },
  "chart_1": {
    "categories": ["优化前", "优化后"],
    "series": [{ "name": "P95响应耗时（毫秒）", "values": [940, 410] }]
  }
}
```

- 写入 `slides[i].nodes`，key 必须来自所选页面 Manifest。表格 `headers` 和每一 `rows` 的列数相同；图表每个系列 `values.length === categories.length`。
- 只允许规定字段；所有标签非空、无不可见格式字符，分类不能重复。图表数值是有限 JSON number，禁止数字字符串、NaN 和 Infinity；圆环值非负，每个系列至少一个正数。
- Schema 约束静态上下限，runtime 继续检查数组间长度一致、重复分类和圆环非零等关系约束，不能只依赖 provider 的 structured output。
- 先判断资料是否有真实数据及图表/趋势/占比/表格表达需求，再选择数据版式；不得为了使用模板而编造数字、单位、精度、分母或统计范围。没有匹配数据时选择其他页面，或明确请求必要资料。
- 用标题、轴标题或邻近说明让单位可见；系列名可能因模板隐藏图例而不显示。保留来源引用，不把模板示例值当资料。
- 业务系统若使用 `tables:[{key,value}]` / `charts:[{key,value}]` 作为中间结构，应明确适配为上面的直接节点对象。此数组结构不是通用 DeckInput 协议。
- 定向修复可使用调用方的 `set_data` 操作，一次替换被报告路径上的整个数据对象，再按同一 Manifest 校验。Skill 不提供模型调用/patch 执行服务；调用方应约束允许路径、操作与次数，不能把它假设成现有 CLI 子命令。禁止将数据字符串化交给 `set_text`，或重生成整份已可校验的输入。

## 原生生成要求

表格保留 `a:tbl`、列宽和单元格样式；删去多余数据行，在原表格区域内分配剩余行高。空单元格也必须插入合法 `a:r/a:t`，保留段落属性，并将 run 放在 `a:endParaRPr` 之前。文本经过 XML 转义。

图表页复用时，对每个输出页面/shape 独立复制 chart part、chart relationships 和内嵌 XLSX，再重定向该页图表关系。不能在模板共享 chart part 上原位改值。同步写入：

1. 系列名称、分类缓存、数值缓存和 `ptCount`。
2. `c:f` 范围公式，以及 XLSX 对应工作表内容和 dimension。
3. 相关表格/筛选范围（如存在），并移除缩短分类后的多余 `c:dPt`。
4. 新 part 的 relationships 与 content types。

“图表能显示”不等于“数据可编辑”；验收必须区分缓存、公式和工作簿。复杂数据标签、工作簿表结构或特殊图表扩展不能仅凭基础测试宣称支持，应另做样例与原生验证。

## 可选配色

最终 DeckInput 可带 `palette`；不传时保持模板配色。模型不得选择配色。集成应用时从既有文章/全局设计解析器得到有效配色，提交时冻结；重试沿用同一快照。

```json
{
  "primary": "#67419A",
  "onPrimary": "#FFFFFF",
  "secondary": "#9574B8",
  "background": "#F8F5FC",
  "surface": "#FFFFFF",
  "text": "#26202E",
  "mutedText": "#716A79",
  "border": "#DDD5E6",
  "chart": ["#67419A", "#9574B8", "#C4AFD9"]
}
```

所有颜色均为 `#RRGGBB`；`chart` 为 3–12 色。Office theme 映射：`dk1=text`、`lt1=background`、`dk2=mutedText`、`lt2=surface`、`accent1=primary`、`accent2=secondary`、`accent3=border`、`accent4..6=chart[0..2]`；超链接使用 primary/secondary。原生图表系列使用 chart 色，圆环按分类着色。

这是显式主题化模板的合同：只有模板将 `lt1` 文字约定为反色文字时，才使用当前 runtime 将其转换为 `onPrimary` 的规则。背景可能带浅色，反色文字不能错误继承 background。源模板硬编码色应在获得模板适配授权后，于准备副本中按语义映射到 theme token；不要用全局颜色替换误伤品牌标志、照片或资料资产。旁置手绘图例也要使用与图表一致的 chart 色，而不是 border。

`runtime-page-number` 是可选的精确节点名称，用于输出实际页码（最少两位）；它与章节 `@序号` 不同。只在模板作者明确标记时启用，不扫描或改写任意数字页脚。
