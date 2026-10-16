/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Design-system vocabulary from DESIGN.md (Tailwind v3 — extend only,
      // so default palette/scale stay intact for legacy screens).
      colors: {
        ink: '#000000',
        paper: '#ffffff',
        mist: '#f4f4f4',
        blush: '#f8dbd5',
        faded: '#cccccc',
        iris: '#2b189b',
        indigo: '#211375',
        teal: '#006654',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      borderRadius: {
        pill: '40px',
        card: '12px',
        small: '4px',
      },
      maxWidth: {
        page: '1200px',
      },
      boxShadow: {
        photo: '0 8px 24px rgba(0,0,0,0.08)',
        mockup: '0 12px 32px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
};
