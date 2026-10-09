/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'] },
      colors: {
        brand: {
          DEFAULT: '#2F95D6',
          50:  '#EFF8FD',
          100: '#D7EEFB',
          200: '#A9DCF5',
          300: '#78C8F0',
          500: '#2F95D6',
          600: '#1668A3',
          700: '#0E3A5F',
        },
        ink: { DEFAULT: '#273240', muted: '#737B8B', faint: '#9AA1AE' },
        line: '#E6E8EC',
        canvas: '#F7F8FB',
      },
      boxShadow: {
        card: '0 1px 2px rgba(64,72,82,0.05), 0 6px 24px rgba(64,72,82,0.06)',
        pop: '0 12px 40px rgba(39,50,64,0.18)',
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
