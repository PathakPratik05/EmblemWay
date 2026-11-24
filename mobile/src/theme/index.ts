export const colors = {
  primary: '#1B4D89',
  primaryDark: '#123764',
  primaryLight: '#E8F0FA',
  accent: '#F2A81D',
  background: '#F5F7FA',
  surface: '#FFFFFF',
  text: '#16202C',
  textMuted: '#5B6675',
  border: '#DCE2EA',
  success: '#2E9E5B',
  warning: '#F2C230',
  orange: '#F08A24',
  danger: '#D93B3B',
  info: '#2F7FD8',
  overlay: 'rgba(16, 24, 40, 0.45)',
  white: '#FFFFFF',
  routeSelf: '#1B4D89',
  routeShared: '#F08A24',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '700' as const, color: colors.text },
  subheading: { fontSize: 15, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  caption: { fontSize: 13, color: colors.textMuted },
  small: { fontSize: 12, color: colors.textMuted },
};

/** Hotspot legend colours (mirrors the backend legend). */
export const levelColors = {
  LOW: colors.success,
  MODERATE: colors.warning,
  HIGH: colors.orange,
  VERY_HIGH: colors.danger,
} as const;

export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};
