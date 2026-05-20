import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

for (const envFile of [".env.local", ".env"]) {
  try {
    const content = readFileSync(join(__dirname, envFile), "utf-8");
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i);
      const v = t.slice(i + 1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

const nextConfig: NextConfig = {
  transpilePackages: [
    "@coding-agents/db",
    "@coding-agents/shared",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
};

export default nextConfig;
