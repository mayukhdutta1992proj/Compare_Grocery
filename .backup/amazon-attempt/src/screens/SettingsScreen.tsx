import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { AiProvider, getKey, setKey } from '../importFiles';
import { DashboardCard } from '../orders/DashboardCard';
import { DEFAULT_SETTINGS, PLATFORMS, PLATFORM_IDS } from '../platforms';
import { C, R, shadow } from '../theme';
import { FeeSettings, PlatformId, Settings } from '../types';

const FIELDS: { key: keyof FeeSettings; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'deliveryFee', label: 'Delivery fee', icon: 'bicycle-outline' },
  { key: 'freeDeliveryAbove', label: 'Free delivery above', icon: 'gift-outline' },
  { key: 'handlingFee', label: 'Handling fee', icon: 'hand-left-outline' },
  { key: 'smallCartFee', label: 'Small-cart fee', icon: 'cart-outline' },
  { key: 'smallCartBelow', label: 'Small-cart fee if below', icon: 'trending-down-outline' },
];

const PROVIDERS: { id: AiProvider; name: string; placeholder: string; badge: string; info: string; note: string }[] = [
  {
    id: 'gemini',
    name: 'Gemini',
    placeholder: 'AIza…',
    badge: 'FREE',
    info: 'Used to read handwritten photos and to pick the best product matches. Get a free key at aistudio.google.com (Get API key). The free tier has daily limits, and Google may use free-tier content to improve its products.',
    note: 'Stored in the iPhone keychain and only sent to Google.',
  },
  {
    id: 'claude',
    name: 'Claude',
    placeholder: 'sk-ant-…',
    badge: 'PAID',
    info: 'Needs an Anthropic API key from console.anthropic.com. Costs roughly ₹1–3 per photo. Used only if no Gemini key is saved.',
    note: 'Stored in the iPhone keychain and only sent to Anthropic.',
  },
];

/** One saved AI key (Gemini or Claude) for reading handwritten photos. */
function KeyRow({ p }: { p: (typeof PROVIDERS)[number] }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    getKey(p.id).then(setSaved).catch(() => setSaved(null));
  }, [p.id]);

  const save = async () => {
    const k = draft.trim();
    await setKey(p.id, k);
    setSaved(k || null);
    setDraft('');
    setEditing(false);
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={s.keyRow}>
        <Text style={[s.label, { flex: 0 }]}>{p.name}</Text>
        <View style={[s.badge, p.badge === 'FREE' ? { backgroundColor: C.goodBg } : { backgroundColor: C.accentSoft }]}>
          <Text style={[s.badgeText, { color: p.badge === 'FREE' ? C.good : C.warn }]}>{p.badge}</Text>
        </View>
      </View>
      <Text style={s.keyText}>{p.info}</Text>
      {saved && !editing ? (
        <View style={s.keyRow}>
          <Ionicons name="checkmark-circle" size={20} color={C.good} />
          <Text style={[s.label, { flex: 1 }]}>Key saved (…{saved.slice(-4)})</Text>
          <Pressable onPress={() => setEditing(true)} hitSlop={6}>
            <Text style={s.link}>Change</Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              await setKey(p.id, '');
              setSaved(null);
            }}
            hitSlop={6}
          >
            <Text style={[s.link, { color: C.bad }]}>Remove</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.keyRow}>
          <TextInput
            style={[s.keyInput, { flex: 1 }]}
            value={draft}
            onChangeText={setDraft}
            placeholder={p.placeholder}
            placeholderTextColor={C.faint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Pressable style={[s.saveBtn, !draft.trim() && { opacity: 0.5 }]} disabled={!draft.trim()} onPress={save}>
            <Text style={s.saveText}>Save</Text>
          </Pressable>
        </View>
      )}
      <Text style={s.keyNote}>{p.note}</Text>
    </View>
  );
}

/** Keys used only when the user taps "Read with AI" on a photo. */
function ApiKeyCard() {
  return (
    <View style={[s.card, shadow]}>
      <View style={[s.cardHead, { backgroundColor: C.text, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Ionicons name="camera-outline" size={16} color={C.white} />
        <Text style={s.platform}>Handwritten lists (optional)</Text>
      </View>
      <View style={{ padding: 14, gap: 16 }}>
        <Text style={s.keyText}>
          Photos are read free on your phone, which works well for printed lists and screenshots. For handwriting,
          tap "Read with AI" on the review screen. That uses Gemini if you add a free key below, otherwise Claude.
        </Text>
        {PROVIDERS.map((p) => (
          <KeyRow key={p.id} p={p} />
        ))}
      </View>
    </View>
  );
}

/** Matching options: Gemini picks, and the remembered products. */
function MatchingCard(props: { aiMatch: boolean; setAiMatch: (v: boolean) => void; rememberedCount: number; onForget: () => void }) {
  return (
    <View style={[s.card, shadow]}>
      <View style={[s.cardHead, { backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Ionicons name="sparkles" size={16} color={C.white} />
        <Text style={s.platform}>Product matching</Text>
      </View>
      <View style={{ padding: 14, gap: 14 }}>
        <View style={s.keyRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Let Gemini pick the best match</Text>
            <Text style={s.keyText}>
              Uses your free Gemini key (below): one request per comparison with only product names, sizes, prices
              and ratings. If it is off or unavailable, the app's own matching is used.
            </Text>
          </View>
          <Switch value={props.aiMatch} onValueChange={props.setAiMatch} trackColor={{ true: C.primary }} />
        </View>
        <View style={s.keyRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Remembered products: {props.rememberedCount}</Text>
            <Text style={s.keyText}>
              When you pick a product or add it to a cart, it's picked first the next time you buy that item.
            </Text>
          </View>
          {props.rememberedCount > 0 && (
            <Pressable
              onPress={() =>
                Alert.alert('Forget remembered products?', 'The app will pick products from scratch again.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Forget', style: 'destructive', onPress: props.onForget },
                ])
              }
              hitSlop={6}
            >
              <Text style={[s.link, { color: C.bad }]}>Forget</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

/** Which stores to compare. Fewer stores = faster comparisons and less memory/data on the phone. */
function StoresCard({ enabled, setEnabled }: { enabled: PlatformId[]; setEnabled: (v: PlatformId[]) => void }) {
  return (
    <View style={[s.card, shadow]}>
      <View style={[s.cardHead, { backgroundColor: C.primaryDark, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Ionicons name="storefront" size={16} color={C.white} />
        <Text style={s.platform}>Stores to compare</Text>
      </View>
      <View style={{ paddingHorizontal: 14, paddingBottom: 6 }}>
        {PLATFORM_IDS.map((pid, i) => {
          const on = enabled.includes(pid);
          return (
            <View key={pid} style={[s.row, i > 0 && s.rowBorder]}>
              <View style={[s.dot, { backgroundColor: PLATFORMS[pid].color }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{PLATFORMS[pid].name}</Text>
                {!PLATFORMS[pid].autoLocation ? <Text style={s.keyNote}>Set its location once on the Stores tab</Text> : null}
              </View>
              <Switch
                value={on}
                trackColor={{ true: C.primary }}
                onValueChange={(v) => {
                  const next = v ? [...enabled, pid] : enabled.filter((x) => x !== pid);
                  if (!next.length) {
                    Alert.alert('Keep at least one store', 'The app needs at least one store to compare.');
                    return;
                  }
                  setEnabled(next);
                }}
              />
            </View>
          );
        })}
        <Text style={[s.keyText, { paddingVertical: 8 }]}>
          Each store runs in its own hidden browser, so fewer stores means faster comparisons and less data.
        </Text>
      </View>
    </View>
  );
}

export function SettingsScreen({
  settings,
  setSettings,
  aiMatch,
  setAiMatch,
  rememberedCount,
  onForget,
  enabledStores,
  setEnabledStores,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  aiMatch: boolean;
  setAiMatch: (v: boolean) => void;
  rememberedCount: number;
  onForget: () => void;
  enabledStores: PlatformId[];
  setEnabledStores: (v: PlatformId[]) => void;
}) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <StoresCard enabled={enabledStores} setEnabled={setEnabledStores} />
      <MatchingCard aiMatch={aiMatch} setAiMatch={setAiMatch} rememberedCount={rememberedCount} onForget={onForget} />
      <ApiKeyCard />
      <DashboardCard />
      <View style={s.info}>
        <Ionicons name="information-circle" size={20} color={C.warn} />
        <Text style={s.infoText}>
          The best option counts these fees. They change often and depend on your city and memberships, so copy the
          real numbers from a recent bill.
        </Text>
      </View>
      {enabledStores.map((pid) => (
        // Keyed on the values so "Reset to defaults" refreshes the inputs.
        <View key={pid + JSON.stringify(settings[pid])} style={[s.card, shadow]}>
          <View style={[s.cardHead, { backgroundColor: PLATFORMS[pid].color }]}>
            <Text style={s.platform}>{PLATFORMS[pid].name}</Text>
          </View>
          {FIELDS.map((f, i) => (
            <View key={f.key} style={[s.row, i > 0 && s.rowBorder]}>
              <Ionicons name={f.icon} size={18} color={C.muted} />
              <Text style={s.label}>{f.label}</Text>
              <View style={s.inputWrap}>
                <Text style={s.rupee}>₹</Text>
                <TextInput
                  style={s.input}
                  keyboardType="number-pad"
                  defaultValue={String(settings[pid][f.key])}
                  onEndEditing={(e) => {
                    const n = parseFloat(e.nativeEvent.text);
                    setSettings({ ...settings, [pid]: { ...settings[pid], [f.key]: isNaN(n) ? 0 : n } });
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      ))}
      <Pressable style={s.reset} onPress={() => setSettings(DEFAULT_SETTINGS)}>
        <Ionicons name="refresh" size={16} color={C.primary} />
        <Text style={s.resetText}>Reset to defaults</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  info: { flexDirection: 'row', gap: 10, backgroundColor: C.warnBg, borderRadius: R.md, padding: 12, marginBottom: 14 },
  infoText: { flex: 1, color: C.warn, lineHeight: 19, fontSize: 13 },
  card: { backgroundColor: C.card, borderRadius: R.lg, marginBottom: 14, overflow: 'hidden' },
  cardHead: { paddingHorizontal: 14, paddingVertical: 10 },
  platform: { fontWeight: '900', fontSize: 15, color: C.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowBorder: { borderTopWidth: 1, borderColor: C.border },
  label: { color: C.text, flex: 1, fontWeight: '600' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: R.sm, paddingHorizontal: 8 },
  rupee: { color: C.muted, fontWeight: '700' },
  input: { width: 56, paddingVertical: 7, textAlign: 'right', color: C.text, fontWeight: '700' },
  keyText: { color: C.muted, fontSize: 13, lineHeight: 19 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  link: { color: C.primary, fontWeight: '700' },
  keyInput: { borderWidth: 1, borderColor: C.border, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15 },
  saveBtn: { backgroundColor: C.primary, borderRadius: R.sm, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  badge: { borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  saveText: { color: C.white, fontWeight: '800' },
  keyNote: { color: C.faint, fontSize: 11 },
  reset: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', padding: 12 },
  resetText: { color: C.primary, fontWeight: '700' },
});
