/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#1c1c1a',
          muted: '#5f5e5a',
          faint: '#888780',
        },
        surface: {
          DEFAULT: '#ffffff',
          sunken: '#f7f6f2',
          line: '#e3e1d9',
        },
        brand: {
          50: '#e1f5ee',
          100: '#9fe1cb',
          500: '#1d9e75',
          600: '#0f6e56',
          700: '#085041',
        },
        state: {
          fresh: '#3b6d11',
          freshBg: '#eaf3de',
          spoiled: '#a32d2d',
          spoiledBg: '#fcebeb',
          review: '#854f0b',
          reviewBg: '#faeeda',
          pending: '#5f5e5a',
          pendingBg: '#f1efe8',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
