import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1400px" } },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "SF Pro Text", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "-apple-system", "SF Pro Display", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        sidebar: "hsl(var(--sidebar))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        olive: {
          50: "#F6F8EF",
          100: "#EBFFAA",
          200: "#D5E3B0",
          300: "#B4C97F",
          400: "#8BA552",
          500: "#6B8538",
          600: "#556B2F",
          700: "#445626",
          800: "#33411D",
          900: "#2F3A1A",
        },
        slate: { 950: "#0B0D0C" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 1px 1px rgba(0,0,0,0.02)",
        card: "0 1px 3px rgba(0,0,0,0.05), 0 8px 24px -12px rgba(0,0,0,0.08)",
        float: "0 12px 40px -12px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.04)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        wiggle: { "0%, 100%": { transform: "rotate(0deg)" }, "20%": { transform: "rotate(-14deg)" }, "40%": { transform: "rotate(12deg)" }, "60%": { transform: "rotate(-8deg)" }, "80%": { transform: "rotate(4deg)" } },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "slide-up": "slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        wiggle: "wiggle 1s ease-in-out 2",
      },
    },
  },
  plugins: [animate, typography],
};

export default config;
