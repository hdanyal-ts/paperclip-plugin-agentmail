import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "plugin-agentmail-paperclip",
    include: ["tests/**/*.spec.ts"],
    environment: "node",
  },
});
