// Medieval / pixel palette and fonts shared by all screens.

export const colors = {
  night: '#1b1410',
  parchment: '#f1e4c3',
  parchmentDark: '#d9c59a',
  ink: '#2b1d12',
  inkSoft: '#6b5338',
  wood: '#8a5a33',
  woodLight: '#b07a46',
  woodDark: '#4a2e18',
  gold: '#e8c872',
  goldDark: '#a3812e',
  hp: '#c0392b',
  xp: '#3f8fd1',
  skill: '#4f9a4a',
  stamina: '#d9822b',
  slot: '#3a2a1c',
  slotBorder: '#20150c',
  // Danger hint text on parchment: each passes 4.5:1 (WCAG AA) on #f1e4c3.
  dangerEasy: '#2f6b2b',
  dangerTough: '#7a5c12',
  dangerDeadly: '#a3281c',
  // Item sheets and the merchant grid sit on this dark panel; every quality color below passes 4.5:1 on it
  // (tests/theme.test.ts).
  sheet: '#3a2a1c',
} as const;

/** Item name colors by quality (catalog `quality`). Readable (≥ 4.5:1) on colors.sheet and colors.slot. */
export const qualityColors = {
  junk: '#b0a89c', // gray
  common: '#f5efe2', // white
  uncommon: '#6fcf62', // green
  rare: '#6fb0ff', // blue
  epic: '#c79bf2', // purple
  legendary: '#e0b030', // dark yellow
} as const;

export const fonts = {
  // Blackletter pixel font for titles and signs
  title: 'Jacquard12_400Regular',
  body: 'PixelifySans_400Regular',
  bodyBold: 'PixelifySans_700Bold',
} as const;
