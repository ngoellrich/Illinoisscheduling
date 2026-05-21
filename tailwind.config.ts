import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#f59e0b", // solar amber
          dark: "#d97706",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
