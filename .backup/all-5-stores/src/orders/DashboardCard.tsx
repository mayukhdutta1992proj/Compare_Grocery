import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { C, R, shadow } from '../theme';
import { ordersApi } from './localApi';
import { getSyncConfig, setSyncConfig, SYNC_PATH, syncOrders } from './sync';

/** Settings card: link order history to an external dashboard (off until filled in). */
export function DashboardCard() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSyncConfig().then((c) => {
      setUrl(c.baseUrl);
      setHasToken(c.hasToken);
      setStatus(c.lastError ?? (c.lastSyncAt ? `Last synced ${new Date(c.lastSyncAt).toLocaleString('en-IN')}` : undefined));
    });
  }, []);

  const saveAndSync = async () => {
    setBusy(true);
    await setSyncConfig(url, token ? token : undefined);
    if (token) setHasToken(true);
    setToken('');
    const r = await syncOrders(ordersApi);
    setBusy(false);
    setStatus(
      r.error ??
        (r.skipped === 'not-configured'
          ? 'Add both the address and the key to turn sync on.'
          : r.skipped === 'nothing-to-send'
            ? 'Linked. Nothing new to send.'
            : `Linked. Sent ${r.accepted} order${r.accepted === 1 ? '' : 's'}.`),
    );
  };

  const unlink = async () => {
    await setSyncConfig('', '');
    setUrl('');
    setHasToken(false);
    setStatus('Unlinked. Orders stay on this phone only.');
  };

  return (
    <View style={[s.card, shadow]}>
      <View style={s.head}>
        <Ionicons name="stats-chart" size={16} color={C.white} />
        <Text style={s.title}>Family dashboard link (optional)</Text>
      </View>
      <View style={{ padding: 14, gap: 10 }}>
        <Text style={s.text}>
          Sends your order history to your dashboard (Finance → Total grocery spending). The dashboard needs the endpoint
          {` ${SYNC_PATH}`} described in docs/ORDER_API.md. Until this is filled in, orders stay on this phone.
        </Text>
        <TextInput
          style={s.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://your-dashboard.vercel.app"
          placeholderTextColor={C.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TextInput
          style={s.input}
          value={token}
          onChangeText={setToken}
          placeholder={hasToken ? 'Key saved (type to replace)' : 'Dashboard API key'}
          placeholderTextColor={C.faint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <View style={s.row}>
          <Pressable style={[s.btn, (!url.trim() || busy) && { opacity: 0.5 }]} disabled={!url.trim() || busy} onPress={saveAndSync}>
            {busy ? <ActivityIndicator size="small" color={C.white} /> : <Text style={s.btnText}>Save and sync</Text>}
          </Pressable>
          {(url || hasToken) && (
            <Pressable onPress={unlink} hitSlop={6}>
              <Text style={s.unlink}>Unlink</Text>
            </Pressable>
          )}
        </View>
        {status ? <Text style={s.status}>{status}</Text> : null}
        <Text style={s.note}>The key is stored in the iPhone keychain and only sent to that dashboard address.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: R.lg, marginBottom: 14, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1F4E79', paddingHorizontal: 14, paddingVertical: 10 },
  title: { color: C.white, fontWeight: '900', fontSize: 15 },
  text: { color: C.muted, fontSize: 13, lineHeight: 19 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  btn: { backgroundColor: C.primary, borderRadius: R.sm, paddingVertical: 11, paddingHorizontal: 18, minWidth: 130, alignItems: 'center' },
  btnText: { color: C.white, fontWeight: '800' },
  unlink: { color: C.bad, fontWeight: '700' },
  status: { color: C.primaryDark, fontSize: 12 },
  note: { color: C.faint, fontSize: 11 },
});
