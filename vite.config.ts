import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER_PORT = process.env.PORT || "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5473,
    proxy: {
      "/api": `http://localhost:${SERVER_PORT}`,
    },
  },
});
