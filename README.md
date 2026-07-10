# PPT DSL Generator

标记好任意 PPTX 模板，就可以让 Codex 帮你根据模板生成 PPT。

## 包含内容

- Codex Skill：`SKILL.md`、分阶段提示词和 DSL 参考资料。
- 独立的 Node/TypeScript 生成器：`assets/ppt-template-dsl-project/`。
- 输入校验、模板检查、分页、包结构检查和测试。
- 面向模板作者的说明：[`docs/DOCS.md`](docs/DOCS.md)。
- 带 DSL 备注的公开学习样例：[`docs/ppt_example.pptx`](docs/ppt_example.pptx)。
- 不包含用户资料、生成的演示文稿或私有资产。

## 环境要求

- Node.js 20 或更高版本。
- 按 [`references/dsl-spec.md`](references/dsl-spec.md) 在演讲者备注中标注 DSL 的 PPTX 模板。
- 完整视觉 QA：Python 3 和 `assets/ppt-template-dsl-project/requirements-qa.txt` 中的依赖。
- macOS 推荐安装可由 AppleScript 控制的 Microsoft PowerPoint，以取得最高渲染保真度；没有时，后备链路需要 LibreOffice/`soffice` 将 PPTX 导出为 PDF。

## 安装与验证

```bash
git clone <你的仓库地址> ppt-dsl-generator
cd ppt-dsl-generator/assets/ppt-template-dsl-project
npm ci
npm run check
npm test
python3 -m pip install -r requirements-qa.txt
```

## 基本流程

```bash
export TEMPLATE=/绝对路径/带-dsl-备注的模板.pptx
export OUT=/绝对路径/输出目录

npm run lint-template -- --template "$TEMPLATE" --out "$OUT"
npm run analyze -- --template "$TEMPLATE" --out "$OUT"
npm run validate-input -- --manifest "$OUT/template-manifest.json" --input /绝对路径/deck-input.json
npm run generate -- --template "$TEMPLATE" --manifest "$OUT/template-manifest.json" --input /绝对路径/deck-input.json --out "$OUT/final.pptx"
npm run qa -- --template "$TEMPLATE" --manifest "$OUT/template-manifest.json" --input /绝对路径/deck-input.json --pptx "$OUT/final.pptx" --out "$OUT/qa" --renderer auto
# 查看全部渲染页，填写 $OUT/qa/visual-review.json 后执行最终 QA gate
npm run qa -- --template "$TEMPLATE" --manifest "$OUT/template-manifest.json" --input /绝对路径/deck-input.json --pptx "$OUT/final.pptx" --out "$OUT/qa" --renderer auto --visual-review "$OUT/qa/visual-review.json" --require-visual-review
```

模板变更后必须重新运行 `analyze`：manifest 内含模板 SHA-256 指纹，生成器会拒绝使用过期 manifest。

`--renderer auto` 会先通过 macOS AppleScript 尝试原生 Microsoft PowerPoint，失败后回退到 LibreOffice。使用 `--renderer powerpoint` 强制原生渲染，使用 `--renderer fallback` 跳过 PowerPoint。`--tools-dir` 仅用于显式指定兼容的自定义渲染工具目录。

## 作为 Codex Skill 使用

将本仓库目录复制或链接到 `$CODEX_HOME/skills/ppt-dsl-generator`；如果未设置 `CODEX_HOME`，则放入 `~/.codex/skills/`。随后创建新的 Codex 任务并调用 `$ppt-dsl-generator`。

## 安全与隐私

仓库刻意排除模板和生成的 PPTX 文件。请将模板和源资料视为潜在敏感内容。本地生成器不会上传它们，但 AI 图片生成或外部渲染器可能适用各自的数据政策，使用前应自行确认。

## 许可证

MIT，见 [LICENSE](LICENSE)。第三方 npm 与 Python 依赖仍分别适用其自身许可证。
