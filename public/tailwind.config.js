// Shared by the browser (Tailwind Play, dev mode) and build.mjs (static CSS).
// Dose theme — token names kept so every screen re-skins at once; values are Dose.
tailwind.config = {
  theme: { extend: {
    fontFamily: {
      display: ['"Schibsted Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      mono: ['"DM Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
    },
    fontWeight: { 400: '400', 500: '500', 600: '600', 700: '700', 800: '800' },
    colors: {
      ink: '#17231d', paper: '#f6f3ea', line: '#d7dfd3',
      brand: { DEFAULT: '#148a5b', 600: '#107049', 700: '#0c5a3a', 50: '#e8f4ec', 100: '#cde9d8', 200: '#a6d7bd' },
      muted: '#5c6b61',
      heat: { calm: '#0f7c45', calmbg: '#dcefdf', light: '#8a6a12', lightbg: '#f3ecc7',
              busy: '#9a5a1e', busybg: '#f3e2cf', heavy: '#9e3330', heavybg: '#f2dcd8' },
    },
    boxShadow: {
      card: 'inset 0 1px 0 rgba(255,255,255,.6), 0 1px 2px rgba(24,45,34,.06), 0 22px 44px -26px rgba(22,60,45,.26)',
      lift: 'inset 0 1px 0 rgba(255,255,255,.6), 0 1px 1px rgba(24,45,34,.10), 8px 18px 28px -14px rgba(22,55,42,.26), 18px 40px 60px -30px rgba(22,60,45,.24)',
      pill: '0 1px 2px rgba(24,45,34,.12)',
    },
    borderRadius: { xl: '10px', xl2: '14px' },
  } },
};
