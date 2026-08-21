import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Git worktrees created by tooling live under .claude/ inside the project.
    // Collecting their tests runs a second copy of the suite whose "@/" imports
    // resolve against *this* source tree, producing phantom failures.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.claude/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/__tests__/**", "lib/hooks/**"],
      thresholds: {
        statements: 40,
        branches: 40,
        functions: 40,
        lines: 40,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
