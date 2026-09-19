# 节点 DSL 规范

## 目录

- 页面备注与普通节点
- 文本长度的精确定义
- 长文本富文本
- 固定列表与 `componentContract`
- icon 与文本的配对合同
- Group 定长/变长列表、布局与 icon 背景
- 必须拒绝的情况

## 页面备注

备注只声明页面级信息：

```text
#页面类型
@内容页
#逻辑关系
@三点并列
@因果递进
```

页面类型仅允许：`封面页`、`目录页`、`章节过渡页`、`内容页`、`结尾页`。解析器兼容不带“页”的 `封面`、`目录`、`章节过渡`、`内容`、`结尾`。

## 普通节点

```text
@文本[4-18]
@图片-1
@图标
@序号-01
@序号-001
```

- 文本必须声明 `[min-max]` 或固定长度 `[n]`。
- `@图片-N` 的编号用于同页图片身份。
- 序号后缀的位数决定补零宽度：`@序号-1`、`@序号-01`、`@序号-001` 分别显示 `1`、`01`、`001`。
- 页面级序号只允许标记在章节过渡页，由生成器按过渡页出现顺序确定性填充；列表项序号按 Item 位置填充。不要让 LLM 生成序号值。
- `DeckInput` 中所有 `number_n` 都是可选字段，包括固定列表、变长列表和章节过渡页序号；普通 `validate-input` 与 `generate` 会在完整校验前补齐。只有直接调用底层校验函数的代码需要先执行相同的确定性绑定。
- 允许 DSL 关键字前后的普通空格；Manifest 保存原始名称。
- `@文本框` 可作为 `@文本` 的兼容别名，但新模板应统一使用 `@文本`。
- 由 `ppt-master` 生成的种子模板中，文本与序号槽位必须使用固定文本框，并设置为 PowerPoint“溢出时缩排文字”（OOXML `a:normAutofit`），不得使用“根据文字调整形状大小”（`a:spAutoFit`）。长度范围负责输入语义，固定宽高与溢出缩排负责几何安全。

### 文本长度的精确定义

长度按遍历字符串得到的 Unicode 码点计算，规则如下：

1. `\p{Cf}` 格式控制字符标记为非法且不计入长度。
2. 普通空格、换行和 Tab 都视为空白；其他 Unicode 空白标记为非法。
3. 前导空白不计入长度。
4. 可见字符之间的一段连续空白只计 1；只有后面再次出现可见字符时，这 1 个空白才计入。
5. 尾随空白不计入长度。

```text
"  alpha     beta  " -> 长度 10
"标题   说明"         -> 长度 5
"标题   "             -> 长度 2
"标题\u200B"          -> 非法，长度 2
```

禁止使用 `ljust`、重复空格、零宽字符或其他不可见字符凑长度。短标题与目录项需要自然改写成完整词语或短语。

### 长文本富文本

富文本不新增节点 DSL。`@文本[min-max]` 的 `max >= 40` 时，编译器为该字段的输入 Schema 增加结构化富文本分支；`max < 40` 时字段仍只能是字符串。资格按模板长度合同判断，不按 `sampleContent` 或本次实际填充值判断。

富文本对象由最多 8 个 paragraph 组成，每个 paragraph 使用 `list = none|bullet|number`，并包含最多 12 个显式 `text/bold/underline` run。只支持单层列表；完整输入和呈现规则见 `references/rich-text.md`。

长度计算时，同一 paragraph 的 run 直接连接，paragraph 之间以换行连接，再使用上面的可见文本算法。自动项目符号与编号不属于输入文本，不计入 `[min-max]`。Markdown/HTML 标记不是 DSL 的一部分，必须拒绝以它们代替结构化格式。

## 固定列表

```text
@1@1 文本[4-10]
@1@1 序号-01
@1@2 文本
@1@2 序号
```

第一个数字是列表 ID，第二个数字是 Item ID。第一项声明组件结构与约束；后续项继承。所有 Item 的组件类型、数量及同类型组件顺序必须一致。

### `componentContract` 的真实形状

Manifest 中的 `componentContract` 是数组，不是以组件 key 为属性的对象。数组元素按第一项的稳定组件顺序排列，只保存继承合同，不包含 locator：

```json
{
  "key": "list_1",
  "listIndex": 1,
  "dynamic": false,
  "minItems": 4,
  "maxItems": 4,
  "items": [
    {
      "itemIndex": 1,
      "components": [
        {
          "key": "text_1",
          "kind": "text",
          "ordinal": 1,
          "sampleContent": "卡片标题",
          "length": { "min": 4, "max": 10, "fixed": false },
          "locator": { "shapeId": "12", "path": [3] }
        },
        {
          "key": "icon_1",
          "kind": "icon",
          "ordinal": 1,
          "sampleContent": "",
          "locator": { "shapeId": "13", "path": [4] }
        },
        {
          "key": "number_1",
          "kind": "number",
          "ordinal": 1,
          "sampleContent": "01",
          "numberWidth": 2,
          "locator": { "shapeId": "14", "path": [5] }
        }
      ]
    }
  ],
  "componentContract": [
    {
      "key": "text_1",
      "kind": "text",
      "ordinal": 1,
      "sampleContent": "卡片标题",
      "length": { "min": 4, "max": 10, "fixed": false }
    },
    {
      "key": "icon_1",
      "kind": "icon",
      "ordinal": 1,
      "sampleContent": ""
    },
    {
      "key": "number_1",
      "kind": "number",
      "ordinal": 1,
      "sampleContent": "01",
      "numberWidth": 2
    }
  ]
}
```

允许字段为 `key/kind/ordinal/sampleContent/length/numberWidth/imageIndex`。`items[].components` 是模板中的实际组件实例并带 locator；`componentContract` 是所有 Item 继承的结构与约束。消费方应按 `component.key` 查找合同，不要把数组误当成对象 Map。

### icon 与文本的配对合同

icon 与文本只通过“属于同一个列表 Item”建立语义配对，不根据页面距离、视觉邻近或 OOXML 全局顺序猜测。重复的 icon-text 卡片必须建模为固定列表或 Group 列表：

```text
@1@1 图标
@1@1 文本[4-10]      # 第一项标题
@1@1 文本[20-80]     # 第一项说明

@1@2 图标
@1@2 文本
@1@2 文本
```

编译后第一项得到 `icon_1/text_1/text_2`，第二项继承相同 key；`icon_1` 与同一 Item 的标题、说明共同表达该 Item 的语义。若每项有多个 icon，第一项中同类组件的稳定顺序分别形成 `icon_1/icon_2`，后续项必须保持可唯一匹配的结构、节点框尺寸和示例内容差异。

页面级散落的 `icon_n` 与 `text_n` 没有自动配对关系。若视觉上存在四组“图标 + 标题 + 说明”，必须回到模板将其标记为四个固定列表 Item 或四个 Group；Agent 不得读取坐标后自行发明配对关系。

## Group 定长/变长列表

将每个完整 Item 制作为 PowerPoint Group。第一组不声明范围时，列表长度固定为模板中的 Group 数量：

```text
@1@1
@1@2
@1@3
```

以上表示定长 3 项，Manifest 写入 `minItems = maxItems = 3`。需要允许 Item 数变化时，只在第一组声明范围：

```text
@1@1[3-5]
@1@2
@1@3
```

- 第一组可省略范围；省略时为定长 Group 列表，长度等于模板中的连续 Group 数量。
- 变长列表只有第一组声明 `[min-max]`，后续组禁止重复声明范围。
- Item ID 从 1 开始连续递增。
- 模板中已有的 Item 数必须位于范围内。
- 新设计模板默认预制到范围上限。例如 `@1@1[3-5]` 应在模板中排布并检查 `@1@1` 至 `@1@5`；之后生成 3 或 4 项时只做删减/重排，避免新增 Item 绕过模板阶段的布局检查。`ppt-master` 生成的种子模板强制遵守此规则。
- Group 包含与该 Item 一起复制、删除、缩放和移动的背景、边框、连接装饰及数据节点。
- 若每个动态 Item 都需要动画，模板必须预制到范围上限个 Group，并为每个 Group 配置动画；删减 Item 时生成器只裁剪对应动画分支，运行时新增克隆不会自动继承 PowerPoint 动画。

Group 内组件不重复列表信息：

```text
@文本[4-10]
@文本[20-80]
@图标
@序号-01
```

第二项及后续项可简写为 `@文本`、`@图标`、`@序号`。约束按同类型组件的出现顺序继承为 `text_1`、`text_2`、`icon_1`、`number_1`。

Group 的外层 `x/y/cx/cy` 也是模板合同。输入 Item 数与模板预制数量一致时，生成器必须原样保留每组几何；数量变化时，普通单行或单列列表沿主轴均匀布局，时间轴、阶梯或蛇形列表则只重排主轴，并继承模板的副轴位置、尺寸与重复周期。例如 `上、下、上、下、上` 的时间轴不得被压成相同 `y`。

图标 SVG 可以使用 `currentColor`，但最终 PPTX 中必须改写为显式颜色。生成器以 icon 的中心点检测背景：只考虑在 OOXML z-order 中位于 icon 之前、覆盖中心点的普通 shape，并从最接近 icon 的候选开始寻找第一个可识别的直接 `solidFill`。`scheme:bg1`、`scheme:lt1`、`preset:white`，或 RGB 三通道均不低于 245 的填充视为白色/近白色，使用深灰 `#404040`；其他可识别填充使用白色 `#FFFFFF`；没有几何、没有覆盖 shape、填充无法识别时也回退白色。该规则不解析母版/布局背景、完整主题色映射、渐变、图片填充或透明度，因此无法确认时始终选择白色，不得由 Agent 按截图覆盖 Runtime 决策。

同一固定或变长列表中的每个 `icon_n` 继承第一项同名图标槽位的几何合同。生成器取第一项槽位宽高的较短边作为统一边长，将所有后续图标框调整为相同正方形，并保持每个图标原中心点不变；不裁剪或改写 SVG 内部路径。

PowerPoint 可能改变重复 Item 内同类型节点的 OOXML 顺序。编译器不得直接依赖 XML 顺序；后续 Item 必须结合第一项的长度范围与节点框尺寸匹配稳定组件槽位。无法得到唯一匹配时拒绝编译。

## 必须拒绝的情况

- 名称以 `@` 开头但无法解析。
- 需要复制或删除完整 Item 的列表使用散落节点而不是 Group。
- 同一个列表同时出现 Group DSL 和固定列表 DSL。
- 第一项 Group ID 不是 1，或后续项重复声明范围。
- Item ID 不连续。
- 后续 Item 的组件合同与第一项不一致。
- 文本既没有长度声明，也不能从第一项继承。
- DSL 节点缺少 `p:cNvPr@id`。
- 页面包含 DSL 名称，但 Manifest 没有生成可编辑节点。

## 原生表格与图表

页面级原生表格命名 `@表格`，页面级原生图表命名 `@图表`；不附范围或编号，不置于列表/Group 内。表格固定列数、数据行数为 1 到模板上限；图表支持柱/条、折线、圆环，固定系列数、分类数为 1 到模板上限，必须有内部 XLSX 工作簿。不可用截图代替。完整 JSON、限制与配色规则见 [原生数据组件](native-data-components.md)。

模板作者可用精确节点名 `runtime-page-number` 声明实际页码（最少两位）；与章节 `@序号` 分开。目录若需 3–5 项，第一项 Group 使用 `@1@1[3-5]` 并预制五项，将随项移动的分隔线和装饰也纳入 Group。
