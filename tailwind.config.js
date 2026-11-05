/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        indigo: {
          50: '#f5f4ff',
          100: '#e9e8ff',
          200: '#d4d2ff',
          300: '#b8b5ff',
          400: '#9995fb',
          500: '#7673eb',
          600: '#6562dd',
          700: '#5350bf',
          800: '#413f96',
          900: '#32316b',
          950: '#211f4c',
        },
        aerospace: {
          canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
          rail: 'rgb(var(--color-rail) / <alpha-value>)',
          surface: 'rgb(var(--color-surface) / <alpha-value>)',
          elevated: 'rgb(var(--color-elevated) / <alpha-value>)',
          muted: 'rgb(var(--color-muted) / <alpha-value>)',
          border: 'rgb(var(--color-border) / <alpha-value>)',
          borderLight: 'rgb(var(--color-border-light) / <alpha-value>)',
        },
        telemetry: {
          emerald: '#10b981',
          indigo: '#7673eb',
          coral: '#f87966',
          amber: '#f59e0b',
          crimson: '#ef4444',
        }
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Cascadia Code',
          'Fira Code',
          'ui-monospace',
          'SF Mono',
          'Consolas',
          'Liberation Mono',
          'Menlo',
          'monospace'
        ],
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI Variable Text',
          'Segoe UI',
          'system-ui',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei UI',
          'Microsoft YaHei',
          'Source Han Sans SC',
          'Noto Sans SC',
          'sans-serif'
        ]
      },
      boxShadow: {
        'soft-sm': '0 1px 3px 0 rgba(53, 48, 103, 0.06), 0 1px 2px -1px rgba(53, 48, 103, 0.05)',
        'soft-md': '0 4px 12px 0 rgba(53, 48, 103, 0.07)',
        'soft-lg': '0 8px 24px 0 rgba(53, 48, 103, 0.1)',
        'glow-indigo': '0 0 16px rgba(118, 115, 235, 0.16)',
        'soft-coral': '0 4px 12px rgba(248, 121, 102, 0.18)',
        'glow-amber': '0 0 16px rgba(245, 158, 11, 0.15)',
      }
    },
  },
  plugins: [],
}
