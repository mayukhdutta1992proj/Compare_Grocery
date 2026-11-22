import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { buildPlans, cheapestFor, lineTotal, Plan, selectedProduct, unitPriceLabel } from '../match';
import { PLATFORMS, PLATFORM_IDS, STORE_NAMES } from '../platforms';
import { C, R, rupees, shadow } from '../theme';
import { CartState, ItemCompare, PlatformId, Product, Settings } from '../types';

interface Props {
  compares: ItemCompare[];
  settings: Settings;
  comparing: boolean;
  onChoose: (itemId: string, pid: PlatformId) => void;
  onSelectProduct: (itemId: string, pid: PlatformId, productId: string) => void;
  onSetCart: (itemId: string, pid: PlatformId, count: number) => void;
  onApplyPlan: (plan: Plan) => void;
  onAddAll: () => void;
  /** Adds every item chosen for this store to its cart. */
  onAddStore: (pid: PlatformId) => void;
  onOpenCart: (pid: PlatformId) => void;
  onGoToList: () => void;
  /** Number of stores switched on (for the progress text). */
  storeCount: number;
  /** Basket edits; the comparison updates only the changed item. */
  onRemove: (itemId: string) => void;
  onChangeCount: (itemId: string, delta: number) => void;
  onAddItem: (query: string) => void;
  /** Searches every item again (e.g. after changing the pincode). */
  onRefreshAll: () => void;
  /** Search one item again on one store (after an error). */
  onRetry: (itemId: string, pid: PlatformId) => void;
  /** Gemini is choosing the best matches right now. */
  aiBusy?: boolean;
  /** Shown when Gemini couldn't help and the app's own matching was used. */
  aiNote?: string;
}

const NAMES = STORE_NAMES;

/** Stores searched for this item, cheapest selected product first; stores without a pick go last. */
function storeOrder(c: ItemCompare): PlatformId[] {
  const ids = PLATFORM_IDS.filter((p) => c.byPlatform[p]);
  return ids
    .map((p, i) => ({ p, i, t: lineTotal(c, p) }))
    .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.i - b.i)
    .map((x) => x.p);
}

export const effectiveChoice = (c: ItemCompare) => c.choice ?? cheapestFor(c);

export function CompareScreen(props: Props) {
  const { compares, settings, comparing } = props;
  const [picker, setPicker] = useState<{ itemId: string; pid: PlatformId } | null>(null);

  const settled = useMemo(
    () => compares.filter((c) => PLATFORM_IDS.every((p) => c.byPlatform[p]?.status !== 'loading')),
    [compares],
  );
  // Progress counts each store's answer for each item, so the bar moves as prices arrive
  // instead of waiting for the slowest store on every item.
  const { checksDone, checksTotal } = useMemo(() => {
    let d = 0, t = 0;
    for (const c of compares) {
      for (const p of PLATFORM_IDS) {
        const r = c.byPlatform[p];
        if (!r) continue;
        t++;
        if (r.status !== 'loading') d++;
      }
    }
    return { checksDone: d, checksTotal: Math.max(t, 1) };
  }, [compares]);
  const updating = compares.length - settled.length; // items added after the first comparison
  // The recommendation only counts items whose prices are in, so adding one item doesn't blank it.
  const plans = useMemo(() => (comparing ? [] : buildPlans(settled, settings, NAMES)), [settled, settings, comparing]);
  const [newItem, setNewItem] = useState('');

  const chosen = useMemo(() => {
    const sub: Partial<Record<PlatformId, { total: number; items: number; inCart: number; adding: number }>> = {};
    for (const c of compares) {
      const pid = effectiveChoice(c);
      const t = pid ? lineTotal(c, pid) : undefined;
      if (!pid || t === undefined) continue;
      const cur = sub[pid] ?? { total: 0, items: 0, inCart: 0, adding: 0 };
      sub[pid] = {
        total: cur.total + t,
        items: cur.items + 1,
        inCart: cur.inCart + (c.cart?.[pid]?.state === 'added' ? 1 : 0),
        adding: cur.adding + (c.cart?.[pid]?.state === 'adding' ? 1 : 0),
      };
    }
    return sub;
  }, [compares]);

  if (!compares.length) {
    return (
      <View style={[s.root, s.center]}>
        <View style={s.emptyIcon}>
          <Ionicons name="pricetags-outline" size={34} color={C.primary} />
        </View>
        <Text style={s.emptyTitle}>Nothing compared yet</Text>
        <Text style={s.emptyText}>Build your basket, then tap Compare prices.</Text>
        <Pressable style={s.emptyBtn} onPress={props.onGoToList}>
          <Text style={s.emptyBtnText}>Go to basket</Text>
        </Pressable>
      </View>
    );
  }

  const pickerItem = picker && compares.find((c) => c.itemId === picker.itemId);

  return (
    <View style={s.root}>
      <FlatList
        data={compares}
        keyExtractor={(c) => c.itemId}
        contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        keyboardShouldPersistTaps="handled"
        // Render only what's near the screen; large baskets stay smooth.
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={7}
        ListHeaderComponent={
          <View>
            {comparing ? (
              <View style={[s.progressCard, shadow]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <ActivityIndicator color={C.primary} />
                  <Text style={s.progressText}>
                    Checking {props.storeCount} stores… {checksDone}/{checksTotal} prices in
                  </Text>
                </View>
                <View style={s.track}>
                  <View style={[s.fill, { width: `${(checksDone / checksTotal) * 100}%` }]} />
                </View>
              </View>
            ) : (
              <Recommendation plans={plans} onApply={props.onApplyPlan} />
            )}
            {!comparing && Object.keys(chosen).length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cartRow}>
                {PLATFORM_IDS.filter((p) => chosen[p]).map((p) => {
                  const c = chosen[p]!;
                  const color = PLATFORMS[p].color;
                  const allIn = c.inCart >= c.items;
                  return (
                    <View key={p} style={[s.cartChip, shadow]}>
                      <View style={s.cartChipTop}>
                        <View style={[s.brandDot, { backgroundColor: color }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.cartChipName}>{NAMES[p]}</Text>
                          <Text style={s.cartChipSub}>
                            {c.items} items · {rupees(c.total)}
                          </Text>
                        </View>
                      </View>
                      {c.adding > 0 ? (
                        <View style={[s.chipBtn, { backgroundColor: C.bg }]}>
                          <ActivityIndicator size="small" color={color} />
                          <Text style={[s.chipBtnText, { color }]}>
                            Adding… {c.inCart}/{c.items}
                          </Text>
                        </View>
                      ) : allIn ? (
                        <View style={[s.chipBtn, { backgroundColor: C.goodBg }]}>
                          <Ionicons name="checkmark" size={14} color={C.good} />
                          <Text style={[s.chipBtnText, { color: C.good }]}>All in cart</Text>
                        </View>
                      ) : (
                        <Pressable style={[s.chipBtn, { backgroundColor: color }]} onPress={() => props.onAddStore(p)}>
                          <Ionicons name="cart" size={14} color={C.white} />
                          <Text style={s.chipBtnText}>
                            Add {c.items - c.inCart} to cart
                          </Text>
                        </Pressable>
                      )}
                      <Pressable onPress={() => props.onOpenCart(p)} hitSlop={6}>
                        <Text style={[s.viewCart, { color }]}>View cart ›</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            )}
            {props.aiBusy && (
              <View style={[s.updating, shadow]}>
                <Ionicons name="sparkles" size={18} color={C.primary} />
                <Text style={[s.updatingText, { flex: 1 }]}>Gemini is checking the best matches…</Text>
                <ActivityIndicator size="small" color={C.primary} />
              </View>
            )}
            {!props.aiBusy && props.aiNote ? (
              <View style={s.aiNote}>
                <Ionicons name="information-circle" size={16} color={C.warn} />
                <Text style={s.aiNoteText}>{props.aiNote}</Text>
              </View>
            ) : null}
            {!comparing && updating > 0 && (
              <View style={[s.updating, shadow]}>
                <ActivityIndicator size="small" color={C.primary} />
                <Text style={s.updatingText}>
                  Checking prices for {updating} new item{updating > 1 ? 's' : ''}…
                </Text>
              </View>
            )}
            <View style={s.sectionRow}>
              <Text style={s.section}>Item by item</Text>
              {!comparing && (
                <Pressable onPress={props.onRefreshAll} hitSlop={8} style={s.refresh}>
                  <Ionicons name="refresh" size={14} color={C.primary} />
                  <Text style={s.refreshText}>Refresh all prices</Text>
                </Pressable>
              )}
            </View>
            <View style={[s.addRow, shadow]}>
              <Ionicons name="add-circle-outline" size={20} color={C.primary} />
              <TextInput
                style={s.addInput}
                value={newItem}
                onChangeText={setNewItem}
                placeholder="Add another item to compare"
                placeholderTextColor={C.faint}
                returnKeyType="done"
                autoCapitalize="none"
                onSubmitEditing={() => {
                  props.onAddItem(newItem);
                  setNewItem('');
                }}
              />
              {newItem.trim() ? (
                <Pressable
                  style={s.addBtn}
                  onPress={() => {
                    props.onAddItem(newItem);
                    setNewItem('');
                  }}
                >
                  <Text style={s.addBtnText}>Add</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <ItemCard
            c={item}
            onChoose={(pid) => props.onChoose(item.itemId, pid)}
            onChange={(pid) => setPicker({ itemId: item.itemId, pid })}
            onSetCart={(pid, n) => props.onSetCart(item.itemId, pid, n)}
            onRemove={() => props.onRemove(item.itemId)}
            onRetry={(pid) => props.onRetry(item.itemId, pid)}
            onChangeCount={(d) => props.onChangeCount(item.itemId, d)}
          />
        )}
      />

      {!comparing && (
        <Pressable style={[s.cta, shadow]} onPress={props.onAddAll}>
          <Ionicons name="cart" size={20} color={C.white} />
          <Text style={s.ctaText}>Add all to carts</Text>
        </Pressable>
      )}

      <Modal visible={!!pickerItem} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(null)}>
        {pickerItem && picker && (
          <View style={{ flex: 1, backgroundColor: C.bg }}>
            <View style={[s.modalHeader, { borderTopColor: PLATFORMS[picker.pid].color }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.modalBrand, { color: PLATFORMS[picker.pid].color }]}>{NAMES[picker.pid]}</Text>
                <Text style={s.modalTitle}>Pick a match for "{pickerItem.query}"</Text>
              </View>
              <Pressable onPress={() => setPicker(null)} hitSlop={10} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
              {(pickerItem.byPlatform[picker.pid]?.products ?? []).map((p) => {
                const sel = pickerItem.byPlatform[picker.pid]?.selectedId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    disabled={!p.available}
                    onPress={() => {
                      props.onSelectProduct(pickerItem.itemId, picker.pid, p.id);
                      setPicker(null);
                    }}
                    style={[s.pickRow, shadow, sel && { borderColor: C.primary }, !p.available && { opacity: 0.45 }]}
                  >
                    <ProductRow p={p} />
                    {sel && <Ionicons name="checkmark-circle" size={22} color={C.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

function Recommendation({ plans, onApply }: { plans: Plan[]; onApply: (p: Plan) => void }) {
  if (!plans.length) return null;
  const best = plans[0];
  const comparable = plans.filter((p) => p.missing.length === best.missing.length);
  const worst = comparable[comparable.length - 1];
  const saving = worst ? worst.total - best.total : 0;
  return (
    <View style={[s.hero, shadow]}>
      <View style={s.heroTop}>
        <View style={s.heroBadge}>
          <Ionicons name="trophy" size={12} color={C.text} />
          <Text style={s.heroBadgeText}>BEST OPTION</Text>
        </View>
        {saving > 0.5 && (
          <View style={s.saveChip}>
            <Text style={s.saveChipText}>Save {rupees(Math.round(saving))}</Text>
          </View>
        )}
      </View>
      <Text style={s.heroTitle}>{best.label}</Text>
      <Text style={s.heroTotal}>{rupees(Math.round(best.total))}</Text>
      <Text style={s.heroSub}>
        incl. ~{rupees(best.fees)} delivery & handling
        {best.missing.length ? ` · not found: ${best.missing.join(', ')}` : ''}
      </Text>

      <View style={s.altBox}>
        {plans.slice(1).map((p) => (
          <Pressable key={p.key} style={s.altRow} onPress={() => onApply(p)}>
            <Text style={s.altLabel} numberOfLines={1}>
              {p.label}
              {p.missing.length ? ` (${p.missing.length} missing)` : ''}
            </Text>
            <Text style={s.altPrice}>{rupees(Math.round(p.total))}</Text>
            <Ionicons name="chevron-forward" size={14} color="#B9D9C6" />
          </Pressable>
        ))}
      </View>

      <Pressable style={s.heroBtn} onPress={() => onApply(best)}>
        <Text style={s.heroBtnText}>Use best option</Text>
      </Pressable>
      <Text style={s.heroNote}>Fees are estimates. Edit them in Settings.</Text>
    </View>
  );
}

function ItemCardInner({
  c,
  onChoose,
  onChange,
  onSetCart,
  onRemove,
  onChangeCount,
  onRetry,
}: {
  c: ItemCompare;
  onChoose: (pid: PlatformId) => void;
  onChange: (pid: PlatformId) => void;
  onSetCart: (pid: PlatformId, n: number) => void;
  onRemove: () => void;
  onChangeCount: (delta: number) => void;
  onRetry: (pid: PlatformId) => void;
}) {
  const choice = effectiveChoice(c);
  const cheapest = cheapestFor(c);
  return (
    <View style={[s.card, shadow]}>
      <View style={s.cardHead}>
        <Text style={s.query} numberOfLines={1}>
          {c.query}
        </Text>
        <View style={s.stepper}>
          <Pressable style={s.stepBtn} onPress={() => (c.count > 1 ? onChangeCount(-1) : onRemove())} hitSlop={4}>
            <Ionicons name={c.count > 1 ? 'remove' : 'trash-outline'} size={15} color={C.warn} />
          </Pressable>
          <Text style={s.qtyPillText}>{c.count}</Text>
          <Pressable style={s.stepBtn} onPress={() => onChangeCount(1)} hitSlop={4}>
            <Ionicons name="add" size={15} color={C.warn} />
          </Pressable>
        </View>
        <Pressable onPress={onRemove} hitSlop={8} style={s.removeBtn}>
          <Ionicons name="close" size={16} color={C.muted} />
        </Pressable>
      </View>
      {/* One tile per store, cheapest first; swipe sideways to see the others. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 2 }}>
        {storeOrder(c).map((pid) => {
          const r = c.byPlatform[pid]!;
          const p = selectedProduct(c, pid);
          const chosen = choice === pid;
          const color = PLATFORMS[pid].color;
          return (
            <Pressable
              key={pid}
              onPress={() => p && onChoose(pid)}
              style={[s.tile, chosen && { borderColor: color, backgroundColor: '#FBFDFB' }]}
            >
              <View style={[s.tileStrip, { backgroundColor: color }]}>
                <Text style={s.tileBrand}>{NAMES[pid]}</Text>
                {chosen && <Ionicons name="checkmark-circle" size={16} color={C.white} />}
              </View>
              {cheapest === pid && (
                <View style={s.ribbon}>
                  <Text style={s.ribbonText}>CHEAPEST</Text>
                </View>
              )}
              <View style={s.tileBody}>
                {r.status === 'loading' || r.status === 'idle' ? (
                  <ActivityIndicator style={{ marginVertical: 30 }} color={color} />
                ) : r.status === 'error' ? (
                  <View style={s.tileMsg}>
                    <Ionicons name="alert-circle-outline" size={22} color={C.bad} />
                    <Text style={s.err}>{r.error}</Text>
                    <Pressable onPress={() => onRetry(pid)} hitSlop={6} style={s.swap}>
                      <Ionicons name="refresh" size={13} color={C.primary} />
                      <Text style={s.swapText}>Try again</Text>
                    </Pressable>
                  </View>
                ) : !p ? (
                  <View style={s.tileMsg}>
                    <Ionicons name="search-outline" size={22} color={C.faint} />
                    <Text style={s.muted}>{r.noMatch ? 'No close match' : 'Not found'}</Text>
                    {r.noMatch && r.products.length > 0 ? (
                      <Pressable onPress={() => onChange(pid)} hitSlop={6} style={s.swap}>
                        <Ionicons name="swap-horizontal" size={13} color={C.primary} />
                        <Text style={s.swapText}>See options ({r.products.length})</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : (
                  <>
                    {r.pickedBy ? (
                      <View style={s.pickedBadge}>
                        <Ionicons
                          name={r.pickedBy === 'history' ? 'time-outline' : r.pickedBy === 'ai' ? 'sparkles' : 'hand-left-outline'}
                          size={11}
                          color={C.primary}
                        />
                        <Text style={s.pickedText}>
                          {r.pickedBy === 'history' ? 'Your usual' : r.pickedBy === 'ai' ? 'AI pick' : 'Your pick'}
                        </Text>
                      </View>
                    ) : null}
                    {p.image ? <Image source={{ uri: p.image }} style={s.img} resizeMode="contain" /> : <View style={s.imgPh} />}
                    <Text style={s.pName} numberOfLines={2}>
                      {p.name}
                    </Text>
                    <Text style={s.pQty}>{p.qty}</Text>
                    <View style={s.priceRow}>
                      <Text style={s.price}>{rupees(p.price)}</Text>
                      {p.mrp > p.price ? <Text style={s.mrp}>{rupees(p.mrp)}</Text> : null}
                    </View>
                    {unitPriceLabel(p) && <Text style={s.unit}>{unitPriceLabel(p)}</Text>}
                    {c.count > 1 && <Text style={s.unit}>Total {rupees(p.price * c.count)}</Text>}
                    {r.warning && <Text style={s.warn}>{r.warning}</Text>}
                    <Pressable onPress={() => onChange(pid)} hitSlop={6} style={s.swap}>
                      <Ionicons name="swap-horizontal" size={13} color={C.primary} />
                      <Text style={s.swapText}>Other options ({r.products.length})</Text>
                    </Pressable>
                    {chosen ? (
                      <CartButton pid={pid} state={c.cart?.[pid]} count={c.count} onSetCart={onSetCart} />
                    ) : c.cart?.[pid]?.state === 'added' ? (
                      <Pressable onPress={() => onSetCart(pid, 0)}>
                        <Text style={s.warn}>Still in {NAMES[pid]} cart · remove</Text>
                      </Pressable>
                    ) : (
                      <Pressable style={s.chooseBtn} onPress={() => onChoose(pid)}>
                        <Text style={s.chooseText}>Buy here instead</Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Only re-render a card when its own item changed. Unchanged items keep the same
 * object between updates, so this skips most of the work while results stream in.
 */
const ItemCard = React.memo(ItemCardInner, (a, b) => a.c === b.c);

function CartButton({
  pid,
  state,
  count,
  onSetCart,
}: {
  pid: PlatformId;
  state: CartState | undefined;
  count: number;
  onSetCart: (pid: PlatformId, n: number) => void;
}) {
  const color = PLATFORMS[pid].color;
  if (state?.state === 'adding')
    return (
      <View style={[s.cartBtn, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={color} size="small" />
      </View>
    );
  if (state?.state === 'added')
    return (
      <View>
        <View style={[s.cartBtn, { backgroundColor: C.goodBg, flexDirection: 'row', gap: 4 }]}>
          <Ionicons name="checkmark" size={15} color={C.good} />
          <Text style={[s.cartBtnText, { color: C.good }]}>In cart</Text>
        </View>
        {state.message ? <Text style={s.warn}>{state.message}</Text> : null}
        <Pressable onPress={() => onSetCart(pid, 0)} hitSlop={6}>
          <Text style={s.removeText}>Remove</Text>
        </Pressable>
      </View>
    );
  return (
    <View>
      {state?.state === 'error' && <Text style={s.err}>{state.message}</Text>}
      <Pressable style={[s.cartBtn, { backgroundColor: color, flexDirection: 'row', gap: 4 }]} onPress={() => onSetCart(pid, count)}>
        <Ionicons name={state?.state === 'error' ? 'refresh' : 'add'} size={15} color={C.white} />
        <Text style={s.cartBtnText}>{state?.state === 'error' ? 'Retry' : 'Add to cart'}</Text>
      </Pressable>
    </View>
  );
}

function ProductRow({ p }: { p: Product }) {
  const unit = unitPriceLabel(p);
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flex: 1 }}>
      {p.image ? <Image source={{ uri: p.image }} style={s.rowImg} resizeMode="contain" /> : <View style={[s.rowImg, s.imgPh]} />}
      <View style={{ flex: 1 }}>
        <Text style={s.pName} numberOfLines={2}>
          {p.name}
        </Text>
        <Text style={s.pQty}>{p.qty}</Text>
        <View style={s.priceRow}>
          <Text style={s.price}>{rupees(p.price)}</Text>
          {p.mrp > p.price ? <Text style={s.mrp}>{rupees(p.mrp)}</Text> : null}
          {unit ? <Text style={[s.unit, { marginLeft: 6 }]}>{unit}</Text> : null}
        </View>
        {!p.available && <Text style={s.err}>Out of stock</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', alignItems: 'center', padding: 30 },
  muted: { color: C.muted, fontSize: 13 },
  section: { fontSize: 13, fontWeight: '800', color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8, marginBottom: 10 },

  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: C.text, marginTop: 14 },
  emptyText: { color: C.muted, textAlign: 'center', marginTop: 6 },
  emptyBtn: { backgroundColor: C.primary, borderRadius: R.md, paddingHorizontal: 20, paddingVertical: 12, marginTop: 16 },
  emptyBtnText: { color: C.white, fontWeight: '800' },

  progressCard: { backgroundColor: C.card, padding: 16, borderRadius: R.lg, marginBottom: 14 },
  progressText: { fontSize: 15, color: C.text, fontWeight: '600' },
  track: { height: 6, backgroundColor: C.primarySoft, borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: C.primary, borderRadius: 3 },

  hero: { backgroundColor: C.primary, borderRadius: R.lg, padding: 18, marginBottom: 14 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accent, borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 4 },
  heroBadgeText: { fontSize: 10, fontWeight: '900', color: C.text, letterSpacing: 0.8 },
  saveChip: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 },
  saveChipText: { color: C.accent, fontWeight: '900', fontSize: 13 },
  heroTitle: { color: '#CFE6D8', fontSize: 15, fontWeight: '700', marginTop: 12 },
  heroTotal: { color: C.white, fontSize: 38, fontWeight: '900', letterSpacing: -1, marginTop: 2 },
  heroSub: { color: '#B9D9C6', fontSize: 12 },
  altBox: { backgroundColor: C.primaryDark, borderRadius: R.md, marginTop: 14, paddingHorizontal: 12, paddingVertical: 4 },
  altRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, gap: 8 },
  altLabel: { flex: 1, color: '#CFE6D8', fontSize: 13 },
  altPrice: { color: C.white, fontWeight: '800', fontSize: 14 },
  heroBtn: { backgroundColor: C.white, borderRadius: R.md, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  heroBtnText: { color: C.primary, fontWeight: '900', fontSize: 15 },
  heroNote: { color: '#9CC5AE', fontSize: 11, textAlign: 'center', marginTop: 8 },

  cartRow: { flexDirection: 'row', gap: 10, marginBottom: 14, paddingRight: 2 },
  cartChip: { width: 168, backgroundColor: C.card, borderRadius: R.md, padding: 12, gap: 8 },
  cartChipTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chipBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: R.sm, paddingVertical: 8 },
  chipBtnText: { color: C.white, fontWeight: '800', fontSize: 13 },
  viewCart: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  brandDot: { width: 10, height: 10, borderRadius: 5 },
  cartChipName: { fontWeight: '800', color: C.text },
  cartChipSub: { color: C.muted, fontSize: 12, marginTop: 1 },

  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 12, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  query: { flex: 1, fontSize: 17, fontWeight: '800', color: C.text, textTransform: 'capitalize' },
  qtyPill: { backgroundColor: C.accentSoft, borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.accentSoft, borderRadius: R.pill },
  stepBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  updating: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: R.md, padding: 12, marginBottom: 12 },
  updatingText: { color: C.text, fontWeight: '600' },
  aiNote: { flexDirection: 'row', gap: 8, backgroundColor: C.warnBg, borderRadius: R.sm, padding: 10, marginBottom: 12 },
  aiNoteText: { flex: 1, color: C.warn, fontSize: 12, lineHeight: 17 },
  pickedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', backgroundColor: C.primarySoft, borderRadius: R.pill, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 4 },
  pickedText: { color: C.primaryDark, fontSize: 10, fontWeight: '800' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refresh: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, marginBottom: 10 },
  refreshText: { color: C.primary, fontWeight: '700', fontSize: 12 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: R.md, paddingLeft: 12, paddingRight: 6, paddingVertical: 4, marginBottom: 12 },
  addInput: { flex: 1, fontSize: 15, color: C.text, paddingVertical: 8 },
  addBtn: { backgroundColor: C.primary, borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: C.white, fontWeight: '800' },
  qtyPillText: { color: C.warn, fontWeight: '800', fontSize: 12 },

  tile: { width: 158, borderWidth: 2, borderColor: C.border, borderRadius: R.md, overflow: 'hidden' },
  tileStrip: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5 },
  tileBrand: { color: C.white, fontWeight: '900', fontSize: 12, letterSpacing: 0.3 },
  ribbon: { position: 'absolute', top: 30, right: 0, backgroundColor: C.accent, borderTopLeftRadius: 6, borderBottomLeftRadius: 6, paddingHorizontal: 6, paddingVertical: 2, zIndex: 2 },
  ribbonText: { fontSize: 9, fontWeight: '900', color: C.text, letterSpacing: 0.5 },
  tileBody: { padding: 10 },
  tileMsg: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  img: { width: '100%', height: 76, marginBottom: 8 },
  imgPh: { height: 76, marginBottom: 8, backgroundColor: C.bg, borderRadius: R.sm },
  rowImg: { width: 60, height: 60, borderRadius: R.sm },
  pName: { fontSize: 13, color: C.text, fontWeight: '600', lineHeight: 17 },
  pQty: { fontSize: 12, color: C.muted, marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 },
  price: { fontSize: 19, fontWeight: '900', color: C.text },
  mrp: { fontSize: 12, color: C.faint, textDecorationLine: 'line-through' },
  unit: { fontSize: 11, color: C.muted, marginTop: 1 },
  swap: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  swapText: { color: C.primary, fontSize: 12, fontWeight: '700' },
  err: { color: C.bad, fontSize: 12, marginTop: 4, textAlign: 'center' },
  warn: { color: C.warn, fontSize: 11, marginTop: 4 },
  cartBtn: { borderRadius: R.sm, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  cartBtnText: { color: C.white, fontWeight: '800', fontSize: 13 },
  removeText: { color: C.bad, fontSize: 12, textAlign: 'center', marginTop: 6 },
  chooseBtn: { borderRadius: R.sm, paddingVertical: 8, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: C.border },
  chooseText: { color: C.muted, fontWeight: '700', fontSize: 12 },

  cta: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: C.text,
    borderRadius: R.md + 2,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  ctaText: { color: C.white, fontSize: 17, fontWeight: '800' },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    backgroundColor: C.card,
    borderTopWidth: 4,
  },
  modalBrand: { fontWeight: '900', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text, marginTop: 2 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  pickRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: R.md, padding: 12, borderWidth: 2, borderColor: 'transparent' },
});
