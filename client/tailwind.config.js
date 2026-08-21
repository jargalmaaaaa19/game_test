/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // The arrow standing on the line with the swimmer stopped behind it.
        // A breath rather than a flash: it has to read as "this one, now" for
        // as long as it takes to notice, without strobing the whole lane.
        waiting: {
          '0%, 100%': { transform: 'translate(-50%, -50%) scale(1.06)' },
          '50%': { transform: 'translate(-50%, -50%) scale(1.2)' },
        },
      },
      animation: {
        rise: 'rise 220ms ease-out both',
        waiting: 'waiting 620ms ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
