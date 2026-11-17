import { readFile } from "node:fs/promises";
import JSZip from "jszip";

export async function readPptx(path: string): Promise<JSZip> {
  const buffer = await readFile(path);
  return JSZip.loadAsync(buffer);
}

export { readZipText, maybeReadZipText } from "./zip.js";
