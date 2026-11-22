import { Platform } from 'react-native';

/** Fresh-market palette: deep leaf green, warm saffron for savings, soft cream background. */
export const C = {
  bg: '#F5F6F1',
  card: '#FFFFFF',
  text: '#14201A',
  muted: '#6B746E',
  faint: '#A3ABA6',
  border: '#E6E9E2',
  primary: '#0B6B3A',
  primaryDark: '#07502B',
  primarySoft: '#E3F2E9',
  accent: '#F4A300',
  accentSoft: '#FFF4DB',
  good: '#0B8A43',
  goodBg: '#E3F5EA',
  bad: '#C2362B',
  badBg: '#FDECEA',
  warn: '#9A6700',
  warnBg: '#FFF6DB',
  white: '#FFFFFF',
};

export const R = { sm: 10, md: 14, lg: 20, pill: 999 };

export const shadow = Platform.select({
  ios: { shadowColor: '#0B2A18', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  default: { elevation: 3 },
});

export const rupees = (n: number) => `₹${Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toFixed(2)}`;
