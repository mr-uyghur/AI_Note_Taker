import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        base:    'var(--bg-base)',
        panel:   'var(--bg-panel)',
        elev:    'var(--bg-elevated)',
        border:  'var(--border)',
        default: 'var(--text)',
        muted:   'var(--text-muted)',
        accent:  'var(--accent)',
        danger:  'var(--danger)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
      },
    },
  },
  plugins: [],
};

export default config;
