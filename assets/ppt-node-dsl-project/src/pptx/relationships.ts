import { XMLParser } from "fast-xml-parser";

export interface PackageRelationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
});

export function parseRelationships(xml: string): PackageRelationship[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = parsed.Relationships as Record<string, unknown> | undefined;
  const values = asArray(root?.Relationship);
  return values
    .map((value) => value as Record<string, unknown>)
    .map((value) => ({
      id: String(value["@_Id"] ?? ""),
      type: String(value["@_Type"] ?? ""),
      target: String(value["@_Target"] ?? ""),
      targetMode: value["@_TargetMode"] ? String(value["@_TargetMode"]) : undefined,
    }))
    .filter((relationship) => relationship.id && relationship.target);
}

export function parsePresentationSlideRelIds(xml: string): string[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const presentation = parsed["p:presentation"] as Record<string, unknown> | undefined;
  const slideList = presentation?.["p:sldIdLst"] as Record<string, unknown> | undefined;
  return asArray(slideList?.["p:sldId"])
    .map((value) => String((value as Record<string, unknown>)["@_r:id"] ?? ""))
    .filter(Boolean);
}

export function relationshipPartForOwner(ownerPart: string): string {
  return joinPart(dirname(ownerPart), "_rels", `${basename(ownerPart)}.rels`);
}

export function ownerPartForRelationshipPart(relsPath: string): string | undefined {
  if (relsPath === "_rels/.rels") return undefined;
  const directory = dirname(relsPath);
  if (!directory.endsWith("_rels")) return undefined;
  return joinPart(dirname(directory), basename(relsPath).replace(/\.rels$/, ""));
}

export function resolveRelationshipTarget(ownerPart: string | undefined, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const ownerDirectory = ownerPart ? dirname(ownerPart) : "";
  return normalizePart(joinPart(ownerDirectory, target));
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// OPC parts always use POSIX separators, regardless of host platform.
function normalizePart(value: string): string {
  const absolute = value.startsWith("/");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else if (part === ".." && !absolute || part !== "..") parts.push(part);
  }
  const result = `${absolute ? "/" : ""}${parts.join("/")}`;
  return result || ".";
}
function joinPart(...parts: string[]): string { return normalizePart(parts.filter(Boolean).join("/")); }
function dirname(value: string): string { const index = value.replace(/\/+$/, "").lastIndexOf("/"); return index < 0 ? "." : value.slice(0, index) || "/"; }
function basename(value: string): string { return value.replace(/\/+$/, "").split("/").at(-1) ?? ""; }
