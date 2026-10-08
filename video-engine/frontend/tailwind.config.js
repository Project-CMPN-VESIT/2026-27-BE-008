/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bebas Neue"', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', 'monospace'],
        sans:    ['"IBM Plex Sans"', 'sans-serif'],
      },
      colors: {
        bg:      '#0a0b0d',
        surface: '#111318',
        card:    '#181c24',
        border:  '#252a35',
        amber:   '#f5a623',
        'amber-dim': '#b8741a',
        green:   '#1fd97a',
        red:     '#ff4d4d',
        blue:    '#4d9fff',
        muted:   '#6b7280',
      },
      animation: {
        'pulse-dot': 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-up':   'fadeUp 0.5s ease forwards',
        'bar-fill':  'barFill 1s cubic-bezier(0.25,0.46,0.45,0.94) forwards',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: 0, transform: 'translateY(12px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        barFill: {
          '0%':   { width: '0%' },
          '100%': { width: 'var(--bar-w)' },
        },
      },
    },
  },
  plugins: [],
}
