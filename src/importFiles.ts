import type AnthropicType from '@anthropic-ai/sdk';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { geminiGenerate, getKey, NeedsApiKeyError } from './gemini';
import { itemsFromModelText, mergeDuplicates, modelItemsToParsed, ParsedItem, parseRows, parseText } from './importParse';

/**
 * Reads a shopping list from an attachment:
 *  - text / CSV / TSV / Markdown: parsed on the phone
 *  - Excel (.xlsx / .xls): parsed on the phone with SheetJS
 *  - photo: read on the phone with free OCR (see OcrEngine.tsx), or by Gemini
 *    (free key) / Claude (paid key) vision, which are better for handwriting
 */

export interface PickedImage {
  uri: string;
  width?: number;
  height?: number;
}

/**
 * The chosen attachments. Text/CSV/Excel files are parsed by `read()` (fast,
 * local). Photos are listed in `images`, and the caller decides how to read
 * them (free OCR or AI). Several of each can be picked at once.
 */
export type PickedFile = { source: string; images: PickedImage[]; read?: () => Promise<ParsedItem[]> };

const MAX_FILES = 10;

export { getKey, NeedsApiKeyError, setKey } from './gemini';
export type { AiProvider } from './gemini';
export const getApiKey = () => getKey('claude');

async function readOneFile(uri: string, name: string, mimeType: string | undefined): Promise<ParsedItem[]> {
  const lower = name.toLowerCase();
  const file = new File(uri);
  if (/\.(xlsx|xlsm|xls|ods)$/.test(lower) || /spreadsheet|excel/.test(mimeType ?? '')) {
    const wb = XLSX.read(await file.base64(), { type: 'base64' });
    // Use every sheet that yields items (people often keep one list per sheet).
    return wb.SheetNames.flatMap((sn) =>
      parseRows(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: '', blankrows: false })),
    );
  }
  return parseText(await file.text());
}

const isImage = (name: string, mimeType?: string) => /^image\//.test(mimeType ?? '') || /\.(jpe?g|png|heic|heif|webp)$/i.test(name);

function describe(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.length} files`;
}

/** Opens the Files picker for text, CSV, Excel or image files (several allowed). Returns null if cancelled. */
export async function pickDocument(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: [
      'text/*',
      'text/csv',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'image/*',
    ],
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const assets = res.assets.slice(0, MAX_FILES);
  const images = assets.filter((a) => isImage(a.name ?? '', a.mimeType)).map((a) => ({ uri: a.uri }));
  const docs = assets.filter((a) => !isImage(a.name ?? '', a.mimeType));
  return {
    source: describe(assets.map((a) => a.name ?? 'file')),
    images,
    read: docs.length
      ? async () => {
          const all: ParsedItem[] = [];
          for (const d of docs) all.push(...(await readOneFile(d.uri, d.name ?? 'file', d.mimeType)));
          return mergeDuplicates(all);
        }
      : undefined,
  };
}

/** Opens the camera (one photo) or the photo library (up to 10 photos). Returns null if cancelled. */
export async function pickPhoto(fromCamera: boolean): Promise<PickedFile | null> {
  if (fromCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission was not given.');
  }
  const res = fromCamera
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: true,
        selectionLimit: MAX_FILES,
        orderedSelection: true,
      });
  if (res.canceled || !res.assets?.length) return null;
  const images = res.assets.slice(0, MAX_FILES).map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
  const source = fromCamera ? 'Camera photo' : images.length > 1 ? `${images.length} photos` : res.assets[0].fileName ?? 'Photo';
  return { source, images };
}

/** Plain text pasted from the clipboard (e.g. copied from WhatsApp or iOS Live Text). */
export function parsePasted(text: string): ParsedItem[] {
  return parseText(text);
}

/**
 * Resizes and re-encodes a photo as JPEG base64 (also converts iPhone HEIC).
 * OCR reads small text better with more pixels; Claude needs no more than ~1568px.
 */
export async function prepareImage(img: PickedImage, maxSide: number): Promise<string> {
  const longSide = Math.max(img.width ?? 0, img.height ?? 0);
  const resize =
    !longSide || longSide > maxSide ? [{ resize: (img.width ?? 0) >= (img.height ?? 0) ? { width: maxSide } : { height: maxSide } }] : [];
  const out = await manipulateAsync(img.uri, resize, { base64: true, compress: 0.85, format: SaveFormat.JPEG });
  if (!out.base64) throw new Error('Could not read the image.');
  return out.base64;
}

const ListSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().describe('Item name as a shopper would search for it, including brand if written, e.g. "Amul butter"'),
      size: z.string().describe('Pack size or weight if written, e.g. "100g", "1l", "5kg"; empty string if none'),
      quantity: z.number().int().describe('How many packs/units to buy; 1 if not written'),
    }),
  ),
});

const PROMPT = `This image is a grocery shopping list (it may be handwritten, a screenshot of a chat, or a printed bill).
List every item to buy, in the order written. Fix obvious spelling mistakes and expand common Indian shorthand
(e.g. "atta" stays "atta", "dhaniya" -> "coriander leaves (dhaniya)"). Keep sizes like 500g/1kg/1l in "size", not in
"quantity". "quantity" is the number of packs or pieces; use 1 when nothing is written. Skip prices, totals, dates,
store names and crossed-out items. If the image is not a shopping list, return an empty list.`;

function toItems(list: z.infer<typeof ListSchema>): ParsedItem[] {
  return modelItemsToParsed(list.items);
}

/**
 * Reads a photo with whichever AI key is saved: Gemini first (has a free
 * tier), then Claude (paid). Both handle handwriting far better than OCR.
 */
export async function readImageWithAi(img: PickedImage): Promise<ParsedItem[]> {
  if (await getKey('gemini')) return readImageWithGemini(img);
  if (await getKey('claude')) return readImageWithClaude(img);
  throw new NeedsApiKeyError(
    'Add a free Gemini key (from aistudio.google.com) in the Settings tab to read handwriting. A Claude key works too, but it is paid.',
  );
}

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, size: { type: 'STRING' }, quantity: { type: 'INTEGER' } },
        required: ['name', 'quantity'],
      },
    },
  },
  required: ['items'],
};

const JSON_SHAPE_HINT =
  '\nAnswer with JSON only, exactly in this shape: {"items":[{"name":"Amul butter","size":"100g","quantity":2}]}';

/** Free tier via a Google AI Studio key. Note: Google may use free-tier content to improve its products. */
export async function readImageWithGemini(img: PickedImage): Promise<ParsedItem[]> {
  const apiKey = await getKey('gemini');
  if (!apiKey) throw new NeedsApiKeyError('Add a free Gemini key in the Settings tab.');
  const base64 = await prepareImage(img, 1568);
  const text = await geminiGenerate(
    apiKey,
    [{ inline_data: { mime_type: 'image/jpeg', data: base64 } }, { text: PROMPT + JSON_SHAPE_HINT }],
    GEMINI_SCHEMA,
    'gemini-photo',
  );
  const items = itemsFromModelText(text);
  if (items) return items;
  console.warn(`[gemini-photo] could not parse answer: ${text.slice(0, 300)}`);
  throw new Error('Gemini answered, but not in a format the app could read. Try again.');
}

/** Optional, paid: reads the photo with Claude vision. Best for handwriting. */
export async function readImageWithClaude(img: PickedImage): Promise<ParsedItem[]> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new NeedsApiKeyError('Add a Claude API key in the Settings tab to use Claude.');
  const base64 = await prepareImage(img, 1568);

  // Loaded only here, never at app start-up: the SDK's ESM build has an import
  // cycle that crashes React Native's bundler on load, so use its CommonJS build.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Anthropic: typeof AnthropicType = require('@anthropic-ai/sdk/index.js').default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod.js') as typeof import('@anthropic-ai/sdk/helpers/beta/zod');

  // The key stays on this phone and is sent only to Anthropic's API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let res;
  try {
    res = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // If Claude declines (very unlikely for a grocery list), retry on the API's default fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(ListSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new NeedsApiKeyError('Your Claude API key was rejected. Check it in the Settings tab.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude is busy right now (rate limit). Try again in a minute.');
    if (e instanceof Anthropic.BadRequestError) throw new Error(`Claude could not process this image: ${e.message}`);
    if (e instanceof Anthropic.APIConnectionError) throw new Error('No internet connection to Claude.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API error ${e.status}: ${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to read this image.');
  const parsed = res.parsed_output;
  if (!parsed) throw new Error('Could not read a list from this image.');

  return toItems(parsed);
}
