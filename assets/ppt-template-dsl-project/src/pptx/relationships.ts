import path from "node:path";
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
  return path.posix.join(path.posix.dirname(ownerPart), "_rels", `${path.posix.basename(ownerPart)}.rels`);
}

export function ownerPartForRelationshipPart(relsPath: string): string | undefined {
  if (relsPath === "_rels/.rels") return undefined;
  const directory = path.posix.dirname(relsPath);
  if (!directory.endsWith("_rels")) return undefined;
  return path.posix.join(path.posix.dirname(directory), path.posix.basename(relsPath, ".rels"));
}

export function resolveRelationshipTarget(ownerPart: string | undefined, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const ownerDirectory = ownerPart ? path.posix.dirname(ownerPart) : "";
  return path.posix.normalize(path.posix.join(ownerDirectory, target));
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
