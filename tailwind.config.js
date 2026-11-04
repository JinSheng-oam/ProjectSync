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
          cyan: '#06b6d4',
          amber: '#f59e0b',
          crimson: '#ef4444',
          indigo: '#6366f1',
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
        'soft-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.08)',
        'soft-md': '0 4px 12px 0 rgba(0, 0, 0, 0.08)',
        'soft-lg': '0 8px 24px 0 rgba(0, 0, 0, 0.12)',
        'glow-cyan': '0 0 16px rgba(6, 182, 212, 0.15)',
        'glow-amber': '0 0 16px rgba(245, 158, 11, 0.15)',
      }
    },
  },
  plugins: [],
}
