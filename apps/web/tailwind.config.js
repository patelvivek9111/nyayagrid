/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14212b",
        paper: "#f4f1ea",
        accent: {
          DEFAULT: "#1f4b3a",
          soft: "#d7e4dd",
        },
        line: "#cfc7ba",
      },
      fontFamily: {
        sans: ["var(--font-source-sans)", "Segoe UI", "sans-serif"],
        display: ["var(--font-fraunces)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
