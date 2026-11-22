import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PLATFORMS } from '../platforms';
import { PlatformId } from '../types';
import { C, R } from '../theme';
import { DeliveryLocation } from '../types';

interface Props {
  title: string;
  subtitle?: string;
  location: DeliveryLocation;
  locating: boolean;
  onLocationPress: () => void;
  /** Stores switched on. */
  stores: PlatformId[];
}

/** Green app header with the delivery-location pill. */
export function Header({ title, subtitle, location, locating, onLocationPress, stores }: Props) {
  // Blinkit/Zepto get the pincode from the app; the others report the address chosen on the Stores tab.
  const confirmed = stores.filter((p) => location.byPlatform[p]?.ok);
  const missing = stores.filter((p) => !location.byPlatform[p]?.ok);
  const label = location.query ? location.query : 'Set delivery pincode';
  return (
    <View style={s.wrap}>
      <Pressable style={s.pill} onPress={onLocationPress} hitSlop={6}>
        <Ionicons name="location" size={16} color={C.accent} />
        <Text style={s.pillLabel}>Deliver to</Text>
        <Text style={s.pillValue} numberOfLines={1}>
          {locating ? 'Updating…' : label}
        </Text>
        <Ionicons name="chevron-down" size={14} color={C.white} />
      </Pressable>
      {location.query && !locating ? (
        <Text style={s.confirm} numberOfLines={1}>
          {!missing.length
            ? `Set on all ${stores.length} store${stores.length === 1 ? '' : 's'}`
            : `Not confirmed yet: ${missing.map((p) => PLATFORMS[p].name).join(', ')}. Tap to check`}
        </Text>
      ) : null}
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: C.primary,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 20,
    borderBottomLeftRadius: R.lg + 4,
    borderBottomRightRadius: R.lg + 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: C.primaryDark,
    borderRadius: R.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: '100%',
  },
  pillLabel: { color: '#B9D9C6', fontSize: 12, fontWeight: '600' },
  pillValue: { color: C.white, fontSize: 14, fontWeight: '800', flexShrink: 1 },
  confirm: { color: '#B9D9C6', fontSize: 11, marginTop: 6, marginLeft: 4 },
  title: { color: C.white, fontSize: 28, fontWeight: '800', marginTop: 14, letterSpacing: -0.5 },
  subtitle: { color: '#CFE6D8', fontSize: 14, marginTop: 4, lineHeight: 19 },
});
