/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base:   'var(--bg-base)',
        panel:  'var(--bg-panel)',
        elev:   'var(--bg-elevated)',
        border: 'var(--border)',
        default:'var(--text)',
        muted:  'var(--text-muted)',
        accent: 'var(--accent)',
        danger: 'var(--danger)',
      },
    },
  },
  plugins: [],
};
