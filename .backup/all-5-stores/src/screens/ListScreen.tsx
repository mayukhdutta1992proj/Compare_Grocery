import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ImportReview } from '../components/ImportReview';
import {
  NeedsApiKeyError,
  parsePasted,
  pickDocument,
  PickedFile,
  PickedImage,
  pickPhoto,
  prepareImage,
  readImageWithAi,
} from '../importFiles';
import { mergeDuplicates, ParsedItem, parseOcrText } from '../importParse';
import { useOcr } from '../OcrEngine';
import { newId } from '../store';
import { C, R, shadow } from '../theme';
import { ListItem } from '../types';

interface Props {
  list: ListItem[];
  setList: (fn: (l: ListItem[]) => ListItem[]) => void;
  onCompare: () => void;
  comparing: boolean;
  /** Opens the screen where AI keys (Gemini / Claude) are entered. */
  onNeedApiKey: () => void;
  /** Lines the user bought before (most used first), with a brand hint like "JK". */
  remembered?: { query: string; hint?: string }[];
}

interface ReviewState {
  visible: boolean;
  loading: boolean;
  loadingText?: string;
  source?: string;
  items: ParsedItem[];
  error?: string;
  /** A gentle warning shown above the results (e.g. a hard-to-read photo). */
  note?: string;
  /** The photos picked, so they can be re-read with AI. */
  images?: PickedImage[];
  /** Items read from text/CSV/Excel files picked together with the photos. */
  fileItems?: ParsedItem[];
}

const CLOSED: ReviewState = { visible: false, loading: false, items: [] };

const QUICK = ['Toned milk 1l', 'Brown bread', 'Eggs 6', 'Amul butter 100g', 'Aashirvaad atta 5kg', 'Onion 1kg', 'Tomato 500g', 'Curd 400g', 'Basmati rice 1kg', 'Bananas'];

export function ListScreen({ list, setList, onCompare, comparing, onNeedApiKey, remembered = [] }: Props) {
  const [text, setText] = useState('');
  const [review, setReview] = useState<ReviewState>(CLOSED);
  const ocr = useOcr();

  /** Adds imported items; an item already in the basket gets its count increased. */
  const addParsed = (items: ParsedItem[]) => {
    setList((l) => {
      const next = [...l];
      for (const it of items) {
        const i = next.findIndex((x) => x.query.toLowerCase() === it.query.toLowerCase());
        if (i >= 0) next[i] = { ...next[i], count: Math.min(20, next[i].count + it.count) };
        else next.push({ id: newId(), query: it.query, count: Math.min(20, it.count) });
      }
      return next;
    });
  };

  const handleError = (e: unknown) => {
    if (e instanceof NeedsApiKeyError) {
      Alert.alert('AI key needed', e.message, [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Add key',
          onPress: () => {
            setReview(CLOSED);
            onNeedApiKey();
          },
        },
      ]);
      setReview((r) => ({ ...r, loading: false }));
      return;
    }
    setReview((r) => ({ ...r, visible: true, loading: false, error: e instanceof Error ? e.message : String(e) }));
  };

  /** Progress label for photo n of total. */
  const photoLabel = (n: number, total: number, what: string) => (total > 1 ? `${what} photo ${n} of ${total}…` : `${what} photo…`);

  /**
   * Free: reads each photo on the phone with Tesseract OCR, one after another,
   * and merges the items with anything already read from files (`fileItems`).
   */
  const readPhotosFree = async (images: PickedImage[], fileItems: ParsedItem[] = []) => {
    setReview((r) => ({ ...r, loading: true, error: undefined, note: undefined, items: [], loadingText: photoLabel(1, images.length, 'Reading') }));
    const all: ParsedItem[] = [...fileItems];
    const hard: number[] = [];
    try {
      for (let k = 0; k < images.length; k++) {
        const base64 = await prepareImage(images[k], 2000);
        const { text: ocrText, confidence } = await ocr.recognize(base64, (fraction, status) => {
          const label = /load|init|download/i.test(status)
            ? 'Getting the text reader ready (first time takes a little longer)…'
            : `${photoLabel(k + 1, images.length, 'Reading')} ${Math.round(fraction * 100)}%`;
          setReview((r) => (r.loading ? { ...r, loadingText: label } : r));
        });
        const items = parseOcrText(ocrText);
        if (!items.length || confidence < 60) hard.push(k + 1);
        all.push(...items);
      }
      const items = mergeDuplicates(all);
      const which = images.length > 1 ? `Photo${hard.length > 1 ? 's' : ''} ${hard.join(', ')} ${hard.length > 1 ? 'were' : 'was'}` : 'The photo was';
      setReview((r) => ({
        ...r,
        loading: false,
        items,
        note: hard.length
          ? `${which} hard to read. Try a flat, well-lit photo, or use "Read with AI" below for handwriting.`
          : undefined,
      }));
    } catch (e) {
      handleError(e);
    }
  };

  /** AI vision (Gemini free key, or Claude paid key): much better at handwriting. Reads every photo. */
  const readPhotosAi = async (images: PickedImage[], fileItems: ParsedItem[] = []) => {
    setReview((r) => ({ ...r, loading: true, error: undefined, note: undefined, items: [], loadingText: photoLabel(1, images.length, 'AI is reading') }));
    const all: ParsedItem[] = [...fileItems];
    try {
      for (let k = 0; k < images.length; k++) {
        setReview((r) => ({ ...r, loadingText: photoLabel(k + 1, images.length, 'AI is reading') }));
        all.push(...(await readImageWithAi(images[k])));
      }
      setReview((r) => ({ ...r, loading: false, items: mergeDuplicates(all) }));
    } catch (e) {
      handleError(e);
    }
  };

  /** Pick first (pickers can't open over a sheet on iOS), then show the review sheet while reading. */
  const runImport = async (pick: () => Promise<PickedFile | null>) => {
    let picked: PickedFile | null;
    try {
      picked = await pick();
    } catch (e) {
      handleError(e);
      return;
    }
    if (!picked) return;
    setReview({ visible: true, loading: true, source: picked.source, images: picked.images, items: [], loadingText: 'Reading the files…' });
    try {
      // Text, CSV and Excel files first (instant), then the photos.
      const fileItems = (await picked.read?.()) ?? [];
      setReview((r) => ({ ...r, fileItems }));
      if (picked.images.length) {
        await readPhotosFree(picked.images, fileItems);
        return;
      }
      setReview((r) => ({ ...r, loading: false, items: fileItems }));
    } catch (e) {
      handleError(e);
    }
  };

  const pasteList = async () => {
    const t = await Clipboard.getStringAsync();
    const items = parsePasted(t ?? '');
    setReview({ visible: true, loading: false, source: 'Clipboard', items, error: t?.trim() ? undefined : 'The clipboard is empty. Copy a list first.' });
  };

  const openAttachMenu = () =>
    Alert.alert('Add items from…', 'We read the item names and quantities. You can check them before they are added.', [
      { text: 'Photos of a list (pick several)', onPress: () => runImport(() => pickPhoto(false)) },
      { text: 'Take a photo', onPress: () => runImport(() => pickPhoto(true)) },
      { text: 'Files (Excel, CSV, text, images)', onPress: () => runImport(pickDocument) },
      { text: 'Paste copied list', onPress: pasteList },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const addQueries = (parts: string[]) => {
    const clean = parts.map((p) => p.trim()).filter(Boolean);
    if (!clean.length) return;
    setList((l) => [...l, ...clean.map((query) => ({ id: newId(), query, count: 1 }))]);
  };

  const add = () => {
    // Several items can be pasted at once, one per line or comma-separated.
    addQueries(text.split(/[\n,]/));
    setText('');
  };

  const bump = (id: string, d: number) =>
    setList((l) => l.map((i) => (i.id === id ? { ...i, count: Math.max(1, Math.min(20, i.count + d)) } : i)));
  const remove = (id: string) => setList((l) => l.filter((i) => i.id !== id));
  const have = new Set(list.map((i) => i.query.toLowerCase()));

  return (
    <View style={s.root}>
      <FlatList
        data={list}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={[s.inputCard, shadow]}>
              <Ionicons name="search" size={20} color={C.muted} />
              <TextInput
                style={s.input}
                value={text}
                onChangeText={setText}
                placeholder="Add item, e.g. amul butter 100g"
                placeholderTextColor={C.faint}
                onSubmitEditing={add}
                returnKeyType="done"
                autoCapitalize="none"
              />
              {text.trim() ? (
                <Pressable style={s.addBtn} onPress={add}>
                  <Ionicons name="add" size={22} color={C.white} />
                </Pressable>
              ) : (
                <Pressable style={s.attachBtn} onPress={openAttachMenu} hitSlop={6}>
                  <Ionicons name="attach" size={22} color={C.primary} />
                </Pressable>
              )}
            </View>

            <Pressable style={s.importCard} onPress={openAttachMenu}>
              <View style={s.importIcon}>
                <Ionicons name="document-attach-outline" size={20} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.importTitle}>Import a list</Text>
                <Text style={s.importSub}>Photos (several at once), Excel, CSV, text, or paste from WhatsApp</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.faint} />
            </Pressable>

            <Text style={s.section}>Quick add</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
              {/* Things you bought before come first, and keep the product you chose last time. */}
              {remembered
                .filter((r) => !have.has(r.query.toLowerCase()))
                .map((r) => (
                  <Pressable key={`r-${r.query}`} style={[s.chip, s.chipRemembered]} onPress={() => addQueries([r.query])}>
                    <Ionicons name="time-outline" size={14} color={C.warn} />
                    <Text style={[s.chipText, { color: C.text }]}>
                      {r.query}
                      {r.hint ? <Text style={s.chipHint}> · {r.hint}</Text> : null}
                    </Text>
                  </Pressable>
                ))}
              {QUICK.filter(
                (q) => !have.has(q.toLowerCase()) && !remembered.some((r) => r.query.toLowerCase() === q.toLowerCase()),
              ).map((q) => (
                <Pressable key={q} style={s.chip} onPress={() => addQueries([q])}>
                  <Ionicons name="add" size={14} color={C.primary} />
                  <Text style={s.chipText}>{q}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={s.listHead}>
              <Text style={s.section}>Your basket</Text>
              {list.length > 0 && (
                <Pressable onPress={() => setList(() => [])} hitSlop={8}>
                  <Text style={s.clear}>Clear all</Text>
                </Pressable>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Ionicons name="basket-outline" size={36} color={C.primary} />
            </View>
            <Text style={s.emptyTitle}>Your basket is empty</Text>
            <Text style={s.emptyText}>Add what you need and we'll find the cheapest store for it.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[s.row, shadow]}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{item.query.trim()[0]?.toUpperCase()}</Text>
            </View>
            <Text style={s.rowText} numberOfLines={2}>
              {item.query}
            </Text>
            <View style={s.stepper}>
              <Pressable style={s.stepBtn} onPress={() => (item.count === 1 ? remove(item.id) : bump(item.id, -1))} hitSlop={4}>
                <Ionicons name={item.count === 1 ? 'trash-outline' : 'remove'} size={16} color={C.white} />
              </Pressable>
              <Text style={s.count}>{item.count}</Text>
              <Pressable style={s.stepBtn} onPress={() => bump(item.id, 1)} hitSlop={4}>
                <Ionicons name="add" size={16} color={C.white} />
              </Pressable>
            </View>
          </View>
        )}
      />

      {list.length > 0 && (
        <Pressable style={[s.cta, shadow, comparing && { opacity: 0.6 }]} disabled={comparing} onPress={onCompare}>
          <View style={s.ctaBadge}>
            <Text style={s.ctaBadgeText}>{list.length}</Text>
          </View>
          <Text style={s.ctaText}>{comparing ? 'Comparing prices…' : 'Compare prices'}</Text>
          <Ionicons name="arrow-forward" size={20} color={C.white} />
        </Pressable>
      )}

      <ImportReview
        visible={review.visible}
        loading={review.loading}
        loadingText={review.loadingText}
        source={review.source}
        items={review.items}
        error={review.error}
        note={review.note}
        altAction={
          review.images?.length && !review.loading
            ? {
                label: `Handwritten? Read ${review.images.length > 1 ? `all ${review.images.length} photos` : 'it'} with AI instead (free with a Gemini key)`,
                onPress: () => readPhotosAi(review.images!, review.fileItems ?? []),
              }
            : undefined
        }
        onClose={() => setReview(CLOSED)}
        onAdd={(items) => {
          addParsed(items);
          setReview(CLOSED);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: R.md,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 8, color: C.text },
  addBtn: { backgroundColor: C.primary, borderRadius: R.sm, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  attachBtn: { backgroundColor: C.primarySoft, borderRadius: R.sm, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  importCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: C.primary,
    backgroundColor: C.card,
  },
  importIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  importTitle: { fontWeight: '800', color: C.text, fontSize: 15 },
  importSub: { color: C.muted, fontSize: 12, marginTop: 1 },
  section: { fontSize: 13, fontWeight: '800', color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.primarySoft,
    borderRadius: R.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipRemembered: { backgroundColor: C.accentSoft },
  chipHint: { color: C.warn, fontWeight: '800' },
  chipText: { color: C.primaryDark, fontWeight: '600', fontSize: 13 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  clear: { color: C.bad, fontWeight: '600', fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 30 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: C.text, marginTop: 14 },
  emptyText: { color: C.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: R.md,
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  avatar: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800', color: C.warn },
  rowText: { flex: 1, fontSize: 16, color: C.text, fontWeight: '600', textTransform: 'capitalize' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.primary, borderRadius: R.sm },
  stepBtn: { paddingHorizontal: 9, paddingVertical: 7 },
  count: { minWidth: 18, textAlign: 'center', fontWeight: '800', color: C.white },
  cta: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: C.primary,
    borderRadius: R.md + 2,
    paddingVertical: 15,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ctaBadge: { backgroundColor: C.accent, borderRadius: R.pill, minWidth: 26, height: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  ctaBadgeText: { color: C.text, fontWeight: '800' },
  ctaText: { flex: 1, color: C.white, fontSize: 17, fontWeight: '800' },
});
