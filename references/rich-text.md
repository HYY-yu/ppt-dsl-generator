# 长文本富文本合同

## 适用范围

富文本用于长文本框的信息分层，不改变节点 DSL。编译后只有文本长度合同 `maxLength >= 40` 的 `text_n` 会在 `deck-content.schema.json` 和 `input.schema.json` 中同时接受字符串与结构化富文本对象；其他文本字段只接受字符串。

判断依据是模板容量上限，不是本次实际填充值。标题、目录项、标签、短卡片标题和序号必须保持纯文本。旧 `DeckInput` 的字符串写法完全兼容。

## 输入结构

```json
{
  "text_2": {
    "paragraphs": [
      {
        "list": "none",
        "runs": [
          { "text": "核心结论", "bold": true, "underline": false },
          { "text": "：留存改善比新增流量更能解释增长。", "bold": false, "underline": false }
        ]
      },
      {
        "list": "bullet",
        "runs": [
          { "text": "先修复首日激活路径", "bold": false, "underline": true }
        ]
      },
      {
        "list": "number",
        "runs": [
          { "text": "验证关键假设", "bold": true, "underline": false }
        ]
      },
      {
        "list": "number",
        "runs": [
          { "text": "扩大有效渠道投入", "bold": false, "underline": false }
        ]
      }
    ]
  }
}
```

每个 paragraph 必须提供：

- `list`：`none`、`bullet` 或 `number`。
- `runs`：1-12 个 run。

每个 run 必须提供非空 `text`、布尔值 `bold` 和布尔值 `underline`。换段必须新建 paragraph；run 的 `text` 禁止包含换行或 Tab。每个富文本字段最多 8 个 paragraph。v1 只支持单层列表。

## LLM 使用规则

默认返回字符串。只有当长文本包含清晰层级且富文本能显著改善阅读时，才返回富文本对象：

- 加粗用于关键结论、关键术语、核心数字；一框通常 1-3 处。
- 下划线用于必须再次聚焦的行动、期限或约束；一框通常 0-1 处。
- 无序列表用于 2-5 个平行要点。
- 有序列表用于 2-5 个有先后关系的步骤、优先级或阶段。
- 不整段加粗或下划线；同一 run 默认不同时加粗和下划线。
- 不为“显得丰富”而混用列表和强调；一段连续说明保持 `list: "none"`。
- 不在 `text` 中写 `**加粗**`、`__下划线__`、`- `、`•` 或 `1.` 等 Markdown/手写标记。格式只由结构字段表达。

原始资料仍是事实来源；富文本只改变呈现层级，不允许为了凑列表编造、拆碎或重复事实。

## 长度与校验

长度计算先按顺序连接同一 paragraph 的 run，再以换行连接 paragraph，最后使用普通文本相同的可见 Unicode 码点算法。段落边界折叠为一个普通空白；PowerPoint 自动生成的项目符号和编号不计入长度。

`--content-only` 与普通最终校验都必须：

- 拒绝短文本字段中的富文本。
- 拒绝未知属性、空 paragraph、空 run、非法 list、非布尔强调属性和 run 内换行。
- 对提取出的纯文本执行原 DSL `[min-max]`、非法空白和格式控制字符检查。

## OOXML 输出

生成器把结构化值写为 DrawingML 原生文本：

- paragraph -> `a:p`。
- run -> `a:r`，加粗为 `a:rPr b="1"`，下划线为 `a:rPr u="sng"`。
- 无序列表 -> `a:pPr/a:buChar`。
- 有序列表 -> `a:pPr/a:buAutoNum type="arabicPeriod"`，连续编号显式写入 `startAt`。
- 非列表段落 -> `a:pPr/a:buNone`，避免继承模板中的列表样式。

生成器以模板目标段落为样式原型，保留字体、字号、颜色、对齐、间距与 `a:normAutofit` 固定几何；模板样例 run 自身的加粗/下划线不作为所有新 run 的默认强调。富文本不得引入 `a:spAutoFit`。
