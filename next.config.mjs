/** @type {import('next').NextConfig} */
const nextConfig = {};

// Wire `next dev` to the local OpenNext/Cloudflare runtime so the D1 binding
// (lib/store.ts) works in development too. No-op outside `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev({ configPath: "./freebuff.wrangler.jsonc" });

export default nextConfig;
