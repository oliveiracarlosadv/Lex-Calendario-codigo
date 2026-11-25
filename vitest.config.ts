import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: { reporter: ["text", "lcov"], include: ["src/domain/**", "src/infrastructure/ai/**", "src/infrastructure/integrations/ics/**", "src/infrastructure/local/**"] },
  },
});
