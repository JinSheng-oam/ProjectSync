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
          50: '#f5f7ff',
          100: '#ebf0fe',
          200: '#dbe4fd',
          300: '#c0cffc',
          400: '#9cb1f9',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
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
          emerald: '#059669',
          indigo: '#4f46e5',
          coral: '#d94635',
          amber: '#d97706',
          crimson: '#dc2626',
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
        'soft-sm': '0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.04)',
        'soft-md': '0 4px 12px 0 rgba(15, 23, 42, 0.06)',
        'soft-lg': '0 8px 24px 0 rgba(15, 23, 42, 0.08)',
        'glow-indigo': '0 0 16px rgba(79, 70, 229, 0.2)',
        'soft-coral': '0 4px 12px rgba(217, 70, 53, 0.2)',
        'glow-amber': '0 0 16px rgba(217, 119, 6, 0.18)',
      }
    },
  },
  plugins: [],
}
