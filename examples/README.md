# 示例说明

本目录提供一套可离线运行的最小闭环示例：

- `ppt_example.pptx`：包含封面、目录、章节过渡、内容和结尾页面的节点 DSL 学习模板。
- `deck-content.example.json`：只包含文案与列表的 9 页内容草稿，用于第一阶段校验。
- `deck-input.example.json`：包含显式章节序号的 9 页完整输入；实际使用时序号也可以省略，由 CLI 自动补齐。
- `模板节点DSL标记指南.md`：制作自有模板的操作说明。

示例 PPTX 只用于学习、测试和持续集成，不是默认生产模板。实际生成时必须传入当前用户提供的模板路径。

## 运行完整示例

从仓库根目录执行：

```bash
PROJECT_DIR="$(pwd)/assets/ppt-node-dsl-project"
TEMPLATE="$(pwd)/examples/ppt_example.pptx"
CONTENT_INPUT="$(pwd)/examples/deck-content.example.json"
INPUT="$(pwd)/examples/deck-input.example.json"
OUT_DIR="$(mktemp -d)/ppt-node-dsl-example"

cd "$PROJECT_DIR"
npm ci
npm run check
npm test

npm run compile-template -- \
  --template "$TEMPLATE" \
  --out "$OUT_DIR/compiled"

npm run validate-input -- \
  --manifest "$OUT_DIR/compiled/template-manifest.json" \
  --input "$CONTENT_INPUT" \
  --content-only

npm run validate-input -- \
  --manifest "$OUT_DIR/compiled/template-manifest.json" \
  --input "$INPUT"

npm run generate -- \
  --template "$OUT_DIR/compiled/template.pptx" \
  --manifest "$OUT_DIR/compiled/template-manifest.json" \
  --input "$INPUT" \
  --out "$OUT_DIR/example.generated.pptx"

npm run verify -- --pptx "$OUT_DIR/example.generated.pptx"
```

所有命令退出码为 0 才表示示例通过。输出保存在临时目录中，不会污染仓库。

## 示例覆盖范围

这套输入会覆盖：

- 第一页封面与最后一页结尾约束。
- 目录项和章节过渡页一一对应。
- 每个章节过渡页后至少包含一页内容页。
- 章节序号从 1 连续递增。
- 纯内容草稿校验与确定性序号绑定。
- `--content-only` 拒绝非文本字段，最终模式要求图片与图标已绑定。
- 固定列表字段与文本长度校验。
- PPTX 生成、备注清理、DSL 名称清理和包关系验证。
- relationship ID、图片关系、动画目标和 creationId 的程序性 Gate。

变长列表、图片和图标的语法与资产规则请继续阅读：

- [`../references/node-dsl-spec.md`](../references/node-dsl-spec.md)
- [`../references/deck-input.md`](../references/deck-input.md)
- [`../references/deck-fill-workflow.md`](../references/deck-fill-workflow.md)
- [`../references/image-generation.md`](../references/image-generation.md)
- [`../references/icon-sources.md`](../references/icon-sources.md)
