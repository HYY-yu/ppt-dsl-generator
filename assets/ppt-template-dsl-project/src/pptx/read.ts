import { readFile } from "node:fs/promises";
import JSZip from "jszip";

export async function readPptx(path: string): Promise<JSZip> {
  const buffer = await readFile(path);
  return JSZip.loadAsync(buffer);
}

export async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`PPTX 文件缺少 ${path}`);
  return file.async("string");
}

export async function maybeReadZipText(zip: JSZip, path: string): Promise<string | undefined> {
  const file = zip.file(path);
  return file?.async("string");
}
