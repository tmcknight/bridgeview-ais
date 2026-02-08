import type { Config } from 'tailwindcss'

export default {
  darkMode: 'selector', // Use class-based dark mode (was 'class' in v3, now 'selector' in v4)
  content: [
    "../index.html",
    "../src/**/*.{js,ts,jsx,tsx}",
  ],
} satisfies Config
