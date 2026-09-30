import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: ["next", "font", "google"].join("/"),
              message:
                "Use @/fonts (self-hosted) — next/font/google breaks Turbopack builds (vercel/next.js#99114)",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CommonJS node scripts (run directly with node, not bundled):
    "prisma/seed.js",
    "test-db.js",
  ]),
]);

export default eslintConfig;
