import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { compileTemplate } from "./compile.js";
import type { AnalyzeTemplateOptions } from "./pptx/analyze.js";

const program = new Command()
  .requiredOption("--template <path>")
  .option("--out <dir>", "输出目录", "compiled-template")
  .option("--notes-shape-name <name>", "优先从指定名称的备注对象读取页面合同")
  .option("--max-same-kind-components <count>", "同一列表项内同类组件的上限", (raw: string) => {
    const count = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(count) || count < 1) {
      throw new InvalidArgumentError("请输入正整数");
    }
    return count;
  });
program.parse();
const { template, out, ...options } = program.opts<AnalyzeTemplateOptions & { template: string; out: string }>();
await compileTemplate(path.resolve(template), path.resolve(out), options);
