import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ParsedItem } from '../importParse';
import { C, R, shadow } from '../theme';

interface Row extends ParsedItem {
  key: string;
  on: boolean;
}

interface Props {
  visible: boolean;
  loading: boolean;
  loadingText?: string;
  source?: string;
  items: ParsedItem[];
  error?: string;
  note?: string;
  /** Extra option under the results, e.g. re-reading a photo with Claude. */
  altAction?: { label: string; onPress: () => void };
  onAdd: (items: ParsedItem[]) => void;
  onClose: () => void;
}

/** Shows what was read from an attachment so the user can fix it before adding. */
export function ImportReview({ visible, loading, loadingText, source, items, error, note, altAction, onAdd, onClose }: Props) {
  const alt = altAction ? (
    <Pressable style={s.alt} onPress={altAction.onPress}>
      <Ionicons name="sparkles-outline" size={16} color={C.primary} />
      <Text style={s.altText}>{altAction.label}</Text>
    </Pressable>
  ) : null;
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    setRows(items.map((it, i) => ({ ...it, key: `${i}-${it.query}`, on: true })));
  }, [items]);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const chosen = rows.filter((r) => r.on && r.query.trim());

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Review items</Text>
            {source ? (
              <Text style={s.sub} numberOfLines={1}>
                From {source}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={s.close}>
            <Ionicons name="close" size={20} color={C.text} />
          </Pressable>
        </View>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.loading}>{loadingText ?? 'Reading your list…'}</Text>
          </View>
        ) : error ? (
          <View style={s.center}>
            <Ionicons name="alert-circle-outline" size={40} color={C.bad} />
            <Text style={s.err}>{error}</Text>
            {alt}
          </View>
        ) : !rows.length ? (
          <View style={s.center}>
            <Ionicons name="document-text-outline" size={40} color={C.faint} />
            <Text style={s.loading}>No items found in this attachment.</Text>
            {note ? <Text style={s.loading}>{note}</Text> : null}
            {alt}
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 8 }}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View>
                {note ? (
                  <View style={s.note}>
                    <Ionicons name="information-circle" size={18} color={C.warn} />
                    <Text style={s.noteText}>{note}</Text>
                  </View>
                ) : null}
                <Text style={s.hint}>
                  {rows.length} found. Untick anything you don't want, and tap a name to edit it.
                </Text>
              </View>
            }
            ListFooterComponent={alt ?? undefined}
            renderItem={({ item: r }) => (
              <View style={[s.row, shadow, !r.on && { opacity: 0.45 }]}>
                <Pressable onPress={() => patch(r.key, { on: !r.on })} hitSlop={8}>
                  <Ionicons name={r.on ? 'checkbox' : 'square-outline'} size={24} color={r.on ? C.primary : C.faint} />
                </Pressable>
                <TextInput
                  style={s.name}
                  value={r.query}
                  onChangeText={(t) => patch(r.key, { query: t })}
                  multiline
                />
                <View style={s.stepper}>
                  <Pressable style={s.stepBtn} onPress={() => patch(r.key, { count: Math.max(1, r.count - 1) })} hitSlop={4}>
                    <Ionicons name="remove" size={15} color={C.primary} />
                  </Pressable>
                  <Text style={s.count}>{r.count}</Text>
                  <Pressable style={s.stepBtn} onPress={() => patch(r.key, { count: Math.min(50, r.count + 1) })} hitSlop={4}>
                    <Ionicons name="add" size={15} color={C.primary} />
                  </Pressable>
                </View>
              </View>
            )}
          />
        )}

        {!loading && !error && rows.length > 0 && (
          <Pressable
            style={[s.cta, shadow, !chosen.length && { opacity: 0.5 }]}
            disabled={!chosen.length}
            onPress={() => onAdd(chosen.map((r) => ({ query: r.query.trim(), count: r.count })))}
          >
            <Ionicons name="basket" size={20} color={C.white} />
            <Text style={s.ctaText}>Add {chosen.length} to basket</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', padding: 18, backgroundColor: C.card, borderTopWidth: 4, borderTopColor: C.primary },
  title: { fontSize: 20, fontWeight: '800', color: C.text },
  sub: { color: C.muted, marginTop: 2 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 12 },
  loading: { color: C.muted, textAlign: 'center', fontSize: 15 },
  err: { color: C.bad, textAlign: 'center', fontSize: 15, lineHeight: 21 },
  hint: { color: C.muted, marginBottom: 6 },
  note: { flexDirection: 'row', gap: 8, backgroundColor: C.warnBg, borderRadius: R.sm, padding: 10, marginBottom: 10 },
  noteText: { flex: 1, color: C.warn, fontSize: 13, lineHeight: 18 },
  alt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  altText: { color: C.primary, fontWeight: '700', fontSize: 13, textAlign: 'center', flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: R.md, padding: 10 },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: C.text, paddingVertical: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.primarySoft, borderRadius: R.sm },
  stepBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  count: { minWidth: 18, textAlign: 'center', fontWeight: '800', color: C.primaryDark },
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
