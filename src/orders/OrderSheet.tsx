import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PLATFORMS, PLATFORM_IDS } from '../platforms';
import { C, R, rupees, shadow } from '../theme';
import { isoLocal, itemsTotalOf } from './summary';
import { GroceryOrder, NewOrder, OrderItem, StoreId } from './types';

export interface OrderDraft {
  store: StoreId;
  items: OrderItem[];
  /** Estimated fees, shown as a hint for the total. */
  estFees: number;
  source: 'app' | 'manual';
}

interface Props {
  visible: boolean;
  /** Edit an existing order, or create one from a draft. */
  order?: GroceryOrder;
  draft?: OrderDraft;
  onSave: (input: NewOrder) => void;
  onDelete?: () => void;
  onClose: () => void;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** Create or edit one order: store, date/time, items, and the amount actually paid. */
export function OrderSheet({ visible, order, draft, onSave, onDelete, onClose }: Props) {
  const [store, setStore] = useState<StoreId>('blinkit');
  const [items, setItems] = useState<OrderItem[]>([]);
  const [total, setTotal] = useState('');
  const [ref, setRef] = useState('');
  const [placedAt, setPlacedAt] = useState(new Date());
  const [estFees, setEstFees] = useState(0);

  useEffect(() => {
    if (!visible) return;
    if (order) {
      setStore(order.store);
      setItems(order.items);
      setTotal(String(order.total));
      setRef(order.storeOrderRef ?? '');
      setPlacedAt(new Date(order.placedAt));
      setEstFees(order.fees);
    } else {
      const its = draft?.items ?? [];
      const sum = itemsTotalOf(its);
      setStore(draft?.store ?? 'blinkit');
      setItems(its);
      setEstFees(draft?.estFees ?? 0);
      setTotal(sum ? String(Math.round(sum + (draft?.estFees ?? 0))) : '');
      setRef('');
      setPlacedAt(new Date());
    }
  }, [visible, order, draft]);

  const itemsTotal = itemsTotalOf(items);
  const totalNum = parseFloat(total.replace(/[^\d.]/g, ''));
  const valid = Number.isFinite(totalNum) && totalNum > 0;

  const shift = (days: number) => setPlacedAt((d) => new Date(d.getTime() + days * 86400000));
  const shiftHours = (h: number) => setPlacedAt((d) => new Date(d.getTime() + h * 3600000));

  const save = () => {
    if (!valid) return;
    onSave({
      store,
      placedAt: isoLocal(placedAt),
      items,
      itemsTotal,
      fees: Math.max(0, Math.round((totalNum - itemsTotal) * 100) / 100),
      total: Math.round(totalNum * 100) / 100,
      source: order?.source ?? draft?.source ?? 'manual',
      storeOrderRef: ref.trim() || undefined,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.head}>
          <Text style={s.title}>{order ? 'Order details' : 'Save order'}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={s.close}>
            <Ionicons name="close" size={20} color={C.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={s.segment}>
            {PLATFORM_IDS.map((pid) => (
              <Pressable key={pid} onPress={() => setStore(pid)} style={[s.segBtn, store === pid && { backgroundColor: PLATFORMS[pid].color }]}>
                <Text style={[s.segText, store === pid && { color: C.white }]}>{PLATFORMS[pid].name}</Text>
              </Pressable>
            ))}
          </View>

          <View style={[s.card, shadow]}>
            <Text style={s.label}>Placed on</Text>
            <View style={s.row}>
              <Pressable onPress={() => shift(-1)} hitSlop={6} style={s.arrow}>
                <Ionicons name="chevron-back" size={18} color={C.primary} />
              </Pressable>
              <Text style={s.when}>{fmtDate(placedAt)}</Text>
              <Pressable onPress={() => shift(1)} hitSlop={6} style={s.arrow}>
                <Ionicons name="chevron-forward" size={18} color={C.primary} />
              </Pressable>
              <View style={{ width: 16 }} />
              <Pressable onPress={() => shiftHours(-1)} hitSlop={6} style={s.arrow}>
                <Ionicons name="remove" size={16} color={C.primary} />
              </Pressable>
              <Text style={s.when}>{fmtTime(placedAt)}</Text>
              <Pressable onPress={() => shiftHours(1)} hitSlop={6} style={s.arrow}>
                <Ionicons name="add" size={16} color={C.primary} />
              </Pressable>
            </View>
          </View>

          <View style={[s.card, shadow]}>
            <Text style={s.label}>Total paid (₹)</Text>
            <TextInput
              style={s.totalInput}
              value={total}
              onChangeText={setTotal}
              keyboardType="decimal-pad"
              placeholder="e.g. 642"
              placeholderTextColor={C.faint}
            />
            <Text style={s.hint}>
              {items.length
                ? `Items ${rupees(itemsTotal)}${estFees ? ` + about ${rupees(estFees)} fees` : ''}. Check the store's bill and correct this if it differs.`
                : 'Enter the amount from the store bill.'}
            </Text>
            <Text style={[s.label, { marginTop: 12 }]}>Store order number (optional)</Text>
            <TextInput style={s.input} value={ref} onChangeText={setRef} placeholder="e.g. ORD12345" placeholderTextColor={C.faint} autoCapitalize="characters" />
          </View>

          {items.length > 0 && (
            <View style={[s.card, shadow]}>
              <Text style={s.label}>Items ({items.length})</Text>
              {items.map((it, i) => (
                <View key={`${it.name}-${i}`} style={s.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemName} numberOfLines={2}>
                      {it.name}
                    </Text>
                    <Text style={s.hint}>
                      {it.qty} · {it.count} × {rupees(it.unitPrice)}
                    </Text>
                  </View>
                  <Text style={s.itemTotal}>{rupees(it.unitPrice * it.count)}</Text>
                  <Pressable onPress={() => setItems((xs) => xs.filter((_, k) => k !== i))} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={C.faint} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {order && onDelete && (
            <Pressable
              onPress={() =>
                Alert.alert('Delete this order?', 'It will be removed from your history and spending totals.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: onDelete },
                ])
              }
              style={s.delete}
            >
              <Ionicons name="trash-outline" size={16} color={C.bad} />
              <Text style={{ color: C.bad, fontWeight: '700' }}>Delete order</Text>
            </Pressable>
          )}
        </ScrollView>
        <Pressable style={[s.cta, shadow, !valid && { opacity: 0.5 }]} disabled={!valid} onPress={save}>
          <Ionicons name="checkmark" size={20} color={C.white} />
          <Text style={s.ctaText}>{order ? 'Save changes' : 'Save to order history'}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', padding: 18, backgroundColor: C.card, borderTopWidth: 4, borderTopColor: C.primary },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: C.text },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: R.md, padding: 4, gap: 4 },
  segBtn: { flexGrow: 1, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12, borderRadius: R.sm },
  segText: { fontWeight: '800', color: C.text },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 14 },
  label: { fontSize: 12, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrow: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  when: { fontSize: 15, fontWeight: '700', color: C.text },
  totalInput: { fontSize: 30, fontWeight: '900', color: C.text, borderBottomWidth: 2, borderColor: C.primary, paddingVertical: 4 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 10, color: C.text },
  hint: { color: C.muted, fontSize: 12, marginTop: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: C.border },
  itemName: { color: C.text, fontWeight: '600' },
  itemTotal: { fontWeight: '800', color: C.text },
  delete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 },
  cta: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 30,
    backgroundColor: C.primary,
    borderRadius: R.md + 2,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  ctaText: { color: C.white, fontSize: 17, fontWeight: '800' },
});
