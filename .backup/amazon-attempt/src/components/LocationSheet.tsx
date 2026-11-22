import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PLATFORMS } from '../platforms';
import { C, R } from '../theme';
import { DeliveryLocation, PlatformId } from '../types';

interface Props {
  visible: boolean;
  location: DeliveryLocation;
  busy: Partial<Record<PlatformId, boolean>>;
  onSubmit: (query: string) => void;
  onClose: () => void;
  /** Stores switched on. */
  stores: PlatformId[];
  /** Opens the Stores tab (to choose the location on stores that need it). */
  onOpenStores: () => void;
}

/**
 * Bottom sheet for the delivery pincode. Submitting sets the same location on
 * both stores, and each store's confirmed address is shown underneath.
 */
export function LocationSheet({ visible, location, busy, onSubmit, onClose, stores, onOpenStores }: Props) {
  const [text, setText] = useState(location.query);
  useEffect(() => {
    if (visible) setText(location.query);
  }, [visible, location.query]);

  const anyBusy = stores.some((p) => busy[p]);
  const valid = text.trim().length >= 3;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.sheet} onPress={Keyboard.dismiss} accessible={false}>
          <View style={s.grabber} />
          <Text style={s.title}>Delivery location</Text>
          <Text style={s.sub}>
            Prices and stock change by area. Enter your pincode, or area + pincode for a closer match (e.g. "Salt
            Lake Sector 2 700091").
          </Text>

          <View style={s.inputRow}>
            <Ionicons name="location-outline" size={20} color={C.primary} />
            <TextInput
              style={s.input}
              value={text}
              onChangeText={setText}
              placeholder="Pincode or area"
              placeholderTextColor={C.faint}
              autoFocus={!location.query}
              returnKeyType="done"
              onSubmitEditing={() => {
                Keyboard.dismiss();
                if (valid && !anyBusy) onSubmit(text.trim());
              }}
            />
          </View>

          <Pressable
            style={[s.btn, (!valid || anyBusy) && { opacity: 0.5 }]}
            disabled={!valid || anyBusy}
            onPress={() => {
              Keyboard.dismiss();
              onSubmit(text.trim());
            }}
          >
            <Text style={s.btnText}>{anyBusy ? 'Setting location…' : 'Set on all stores'}</Text>
          </Pressable>

          <View style={{ marginTop: 18, gap: 10 }}>
            {stores.map((pid) => {
              const r = location.byPlatform[pid];
              const manual = !PLATFORMS[pid].autoLocation;
              return (
                <View key={pid} style={s.storeRow}>
                  <View style={[s.dot, { backgroundColor: PLATFORMS[pid].color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.storeName}>{PLATFORMS[pid].name}</Text>
                    {busy[pid] ? (
                      <Text style={s.storeAddr}>Updating…</Text>
                    ) : r?.ok ? (
                      <Text style={s.storeAddr} numberOfLines={2}>
                        {r.address}
                      </Text>
                    ) : manual ? (
                      <Pressable onPress={onOpenStores} hitSlop={6}>
                        <Text style={[s.storeAddr, { color: r?.error ? C.bad : C.primary, fontWeight: '700' }]}>
                          {r?.error ? `${r.error} ›` : 'Not detected yet. Choose it on the Stores tab ›'}
                        </Text>
                      </Pressable>
                    ) : r?.error ? (
                      <Text style={[s.storeAddr, { color: C.bad }]}>{r.error}</Text>
                    ) : (
                      <Text style={s.storeAddr}>Not set yet</Text>
                    )}
                    {r?.notServiceable ? <Text style={[s.storeAddr, { color: C.bad }]}>Store may not deliver here</Text> : null}
                  </View>
                  {busy[pid] ? (
                    <ActivityIndicator color={C.primary} />
                  ) : r?.ok ? (
                    <Ionicons name="checkmark-circle" size={22} color={C.good} />
                  ) : manual ? (
                    <Ionicons name="storefront-outline" size={20} color={C.muted} />
                  ) : r?.error ? (
                    <Ionicons name="alert-circle" size={22} color={C.bad} />
                  ) : null}
                </View>
              );
            })}
          </View>
          <Text style={s.note}>
            Logged in with saved addresses? You can also pick one in the Stores tab.
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,25,16,0.45)' },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: R.lg + 4,
    borderTopRightRadius: R.lg + 4,
    padding: 20,
    paddingBottom: 36,
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.border, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 22, fontWeight: '800', color: C.text },
  sub: { color: C.muted, marginTop: 6, lineHeight: 19 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    borderWidth: 1.5,
    borderColor: C.primary,
    borderRadius: R.md,
    paddingHorizontal: 12,
    backgroundColor: C.primarySoft,
  },
  input: { flex: 1, fontSize: 17, paddingVertical: 12, color: C.text, fontWeight: '600' },
  btn: { backgroundColor: C.primary, borderRadius: R.md, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  btnText: { color: C.white, fontSize: 16, fontWeight: '800' },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.bg,
    borderRadius: R.md,
    padding: 12,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  storeName: { fontWeight: '800', color: C.text },
  storeAddr: { color: C.muted, fontSize: 13, marginTop: 2 },
  note: { color: C.faint, fontSize: 12, marginTop: 14, textAlign: 'center' },
});
