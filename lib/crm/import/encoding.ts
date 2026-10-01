// Tekstdekoding for importfiler: UTF-8 (med/uten BOM), UTF-16 («Unicode-tekst»
// fra Excel), Windows-1252/ISO-8859-1 fra eldre Excel, og reparasjon av
// dobbeltkodet UTF-8 («BjÃ¸rn» → «Bjørn»).

export type DetectedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  text: string;
  encoding: DetectedEncoding;
  /** true når ødelagte æøå («Ã¸») ble reparert. */
  repaired: boolean;
}

export function decodeImportBytes(bytes: Uint8Array): DecodedText {
  let encoding: DetectedEncoding;
  let text: string;

  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  } else {
    const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
      encoding = 'utf-8';
    } catch {
      text = new TextDecoder('windows-1252').decode(body);
      encoding = 'windows-1252';
    }
  }

  const fixed = repairMojibake(text.replace(/^﻿/, ''));
  return { text: fixed.text, encoding, repaired: fixed.repaired };
}

let cp1252Bytes: Map<string, number> | null = null;

function cp1252ByteMap(): Map<string, number> {
  if (cp1252Bytes) return cp1252Bytes;
  const decoder = new TextDecoder('windows-1252');
  const map = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) map.set(decoder.decode(new Uint8Array([b])), b);
  // ISO-8859-1-dekodere gir rå C1-tegn i stedet for Windows-1252-tegnene.
  for (let b = 0x80; b <= 0x9f; b++) if (!map.has(String.fromCharCode(b))) map.set(String.fromCharCode(b), b);
  cp1252Bytes = map;
  return map;
}

// Sekvenser av to eller flere tegn som kan være UTF-8-bytes lest som Windows-1252.
const SUSPECT_RUN =
  /[\u0080-ÿŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]{2,}/g;

/**
 * Reparerer hver mistenkelig tegnsekvens for seg, så tekst som blander riktige
 * og ødelagte æøå også blir riktig. Ekte norsk tekst («æø») er aldri gyldig
 * UTF-8 når den tolkes som bytes, så den blir stående urørt.
 */
export function repairMojibake(text: string): { text: string; repaired: boolean } {
  if (!/[ÃÂâ]/.test(text)) return { text, repaired: false };
  const map = cp1252ByteMap();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let repaired = false;

  const out = text.replace(SUSPECT_RUN, (run) => {
    const bytes: number[] = [];
    for (const ch of run) {
      const b = map.get(ch);
      if (b === undefined) return run;
      bytes.push(b);
    }
    try {
      const decoded = utf8.decode(new Uint8Array(bytes));
      if (decoded === run) return run;
      repaired = true;
      return decoded;
    } catch {
      return run;
    }
  });

  return { text: out, repaired };
}
