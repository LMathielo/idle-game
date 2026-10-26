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
} as const;

export const fonts = {
  // Blackletter pixel font for titles and signs
  title: 'Jacquard12_400Regular',
  body: 'PixelifySans_400Regular',
  bodyBold: 'PixelifySans_700Bold',
} as const;
