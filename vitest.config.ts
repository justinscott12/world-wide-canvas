import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "client/**/*.test.ts"],
    environment: "node",
  },
});
