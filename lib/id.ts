import { randomBytes } from "crypto";

export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
