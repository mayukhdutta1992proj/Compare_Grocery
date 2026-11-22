import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { PLATFORMS, PLATFORM_IDS } from '../platforms';
import { C, R, rupees, shadow } from '../theme';
import { ordersApi } from './localApi';
import { OrderSheet } from './OrderSheet';
import { getSyncConfig, syncOrders } from './sync';
import { GroceryOrder, SpendSummary } from './types';

const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** Order history: spending totals and every saved order, newest first. */
export function OrdersScreen({ onAddFromStore }: { onAddFromStore: () => void }) {
  const [orders, setOrders] = useState<GroceryOrder[]>([]);
  const [month, setMonth] = useState<SpendSummary | null>(null);
  const [last30, setLast30] = useState<SpendSummary | null>(null);
  const [all, setAll] = useState<SpendSummary | null>(null);
  const [editing, setEditing] = useState<GroceryOrder | null>(null);
  const [adding, setAdding] = useState(false);
  const [sync, setSync] = useState<{ configured: boolean; busy: boolean; text?: string }>({ configured: false, busy: false });

  const refresh = useCallback(async () => {
    const [list, m, d30, a, cfg] = await Promise.all([
      ordersApi.list(),
      ordersApi.summary({ from: startOfMonth() }),
      ordersApi.summary({ from: daysAgo(30) }),
      ordersApi.summary(),
      getSyncConfig(),
    ]);
    setOrders(list);
    setMonth(m);
    setLast30(d30);
    setAll(a);
    setSync((st) => ({
      ...st,
      configured: !!cfg.baseUrl && cfg.hasToken,
      text: st.busy ? st.text : cfg.lastError ?? (cfg.lastSyncAt ? `Last synced ${new Date(cfg.lastSyncAt).toLocaleString('en-IN')}` : undefined),
    }));
  }, []);

  useEffect(() => {
    refresh();
    return ordersApi.subscribe(refresh);
  }, [refresh]);

  const doSync = async () => {
    setSync((st) => ({ ...st, busy: true, text: 'Syncing…' }));
    const r = await syncOrders(ordersApi);
    setSync((st) => ({
      ...st,
      busy: false,
      text: r.error
        ? r.error
        : r.skipped === 'nothing-to-send'
          ? 'Everything is already synced'
          : r.skipped === 'not-configured'
            ? 'Set up the dashboard link in Settings'
            : `Synced ${r.accepted} order${r.accepted === 1 ? '' : 's'}${r.rejected ? `, ${r.rejected} rejected` : ''}`,
    }));
    refresh();
  };

  const monthsWithOrders = useMemo(() => all?.byMonth ?? [], [all]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 6 }}>
            <View style={[s.hero, shadow]}>
              <Text style={s.heroLabel}>GROCERY SPENDING THIS MONTH</Text>
              <Text style={s.heroTotal}>{rupees(month?.totalSpend ?? 0)}</Text>
              <Text style={s.heroSub}>
                {month?.orderCount ?? 0} order{month?.orderCount === 1 ? '' : 's'}
                {PLATFORM_IDS.filter((p) => (month?.byStore[p]?.total ?? 0) > 0)
                  .map((p) => ` · ${PLATFORMS[p].name} ${rupees(month!.byStore[p].total)}`)
                  .join('')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={[s.stat, shadow]}>
                <Text style={s.statLabel}>Last 30 days</Text>
                <Text style={s.statValue}>{rupees(last30?.totalSpend ?? 0)}</Text>
              </View>
              <View style={[s.stat, shadow]}>
                <Text style={s.statLabel}>All time</Text>
                <Text style={s.statValue}>{rupees(all?.totalSpend ?? 0)}</Text>
                <Text style={s.statSub}>{all?.orderCount ?? 0} orders</Text>
              </View>
            </View>
            {monthsWithOrders.length > 1 && (
              <View style={[s.months, shadow]}>
                {monthsWithOrders.slice(0, 6).map((m) => (
                  <View key={m.month} style={s.monthRow}>
                    <Text style={s.monthName}>{monthLabel(m.month)}</Text>
                    <Text style={s.monthOrders}>{m.orders} orders</Text>
                    <Text style={s.monthTotal}>{rupees(m.total)}</Text>
                  </View>
                ))}
              </View>
            )}
            {sync.configured && (
              <Pressable style={s.syncRow} onPress={doSync} disabled={sync.busy}>
                {sync.busy ? <ActivityIndicator size="small" color={C.primary} /> : <Ionicons name="cloud-upload-outline" size={16} color={C.primary} />}
                <Text style={s.syncText}>{sync.text ?? 'Sync with family dashboard'}</Text>
                {!sync.busy && <Text style={s.syncLink}>Sync now</Text>}
              </Pressable>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable style={[s.addBtn, { flex: 1 }]} onPress={onAddFromStore}>
                <Ionicons name="cart-outline" size={16} color={C.white} />
                <Text style={s.addBtnText}>Save order from cart</Text>
              </Pressable>
              <Pressable style={[s.addBtn, s.addBtnAlt]} onPress={() => setAdding(true)}>
                <Ionicons name="create-outline" size={16} color={C.primary} />
                <Text style={[s.addBtnText, { color: C.primary }]}>Add manually</Text>
              </Pressable>
            </View>
            <Text style={s.section}>Past orders</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="receipt-outline" size={36} color={C.faint} />
            <Text style={s.emptyText}>
              No orders yet. After you check out on any store, tap "Save order from cart" (or the app will ask when it
              spots an order confirmation).
            </Text>
          </View>
        }
        renderItem={({ item: o }) => {
          const d = new Date(o.placedAt);
          return (
            <Pressable style={[s.order, shadow]} onPress={() => setEditing(o)}>
              <View style={[s.storeBar, { backgroundColor: PLATFORMS[o.store].color }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.orderStore}>{PLATFORMS[o.store].name}</Text>
                <Text style={s.orderWhen}>
                  {d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
                  {d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                </Text>
                <Text style={s.orderItems} numberOfLines={1}>
                  {o.items.length ? `${o.items.length} items: ${o.items.map((i) => i.name.split(/\s+/).slice(0, 2).join(' ')).join(', ')}` : 'No item list'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={s.orderTotal}>{rupees(o.total)}</Text>
                {sync.configured ? (
                  <Ionicons name={o.syncedAt ? 'cloud-done-outline' : 'cloud-offline-outline'} size={14} color={o.syncedAt ? C.good : C.faint} />
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />

      <OrderSheet
        visible={!!editing || adding}
        order={editing ?? undefined}
        draft={adding ? { store: 'blinkit', items: [], estFees: 0, source: 'manual' } : undefined}
        onClose={() => {
          setEditing(null);
          setAdding(false);
        }}
        onSave={async (input) => {
          if (editing) await ordersApi.update(editing.id, input);
          else await ordersApi.create(input);
          setEditing(null);
          setAdding(false);
          syncOrders(ordersApi).then(refresh);
        }}
        onDelete={
          editing
            ? async () => {
                await ordersApi.remove(editing.id);
                setEditing(null);
                syncOrders(ordersApi).then(refresh);
              }
            : undefined
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: C.primary, borderRadius: R.lg, padding: 18 },
  heroLabel: { color: '#B9D9C6', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  heroTotal: { color: C.white, fontSize: 36, fontWeight: '900', marginTop: 4, letterSpacing: -1 },
  heroSub: { color: '#CFE6D8', fontSize: 12, marginTop: 2 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: R.md, padding: 12 },
  statLabel: { color: C.muted, fontSize: 12, fontWeight: '700' },
  statValue: { color: C.text, fontSize: 20, fontWeight: '900', marginTop: 2 },
  statSub: { color: C.faint, fontSize: 11 },
  months: { backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 4 },
  monthRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  monthName: { flex: 1, color: C.text, fontWeight: '600' },
  monthOrders: { color: C.muted, fontSize: 12 },
  monthTotal: { color: C.text, fontWeight: '800', minWidth: 70, textAlign: 'right' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primarySoft, borderRadius: R.md, padding: 10 },
  syncText: { flex: 1, color: C.primaryDark, fontSize: 12 },
  syncLink: { color: C.primary, fontWeight: '800', fontSize: 12 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.primary, borderRadius: R.md, paddingVertical: 11, paddingHorizontal: 12 },
  addBtnAlt: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.primary },
  addBtnText: { color: C.white, fontWeight: '800', fontSize: 13 },
  section: { fontSize: 13, fontWeight: '800', color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6 },
  empty: { alignItems: 'center', padding: 30, gap: 10 },
  emptyText: { color: C.muted, textAlign: 'center', lineHeight: 20 },
  order: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.md, padding: 12, marginBottom: 10, overflow: 'hidden' },
  storeBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  orderStore: { fontWeight: '800', color: C.text },
  orderWhen: { color: C.muted, fontSize: 12, marginTop: 1 },
  orderItems: { color: C.faint, fontSize: 12, marginTop: 2 },
  orderTotal: { fontSize: 18, fontWeight: '900', color: C.text },
});
