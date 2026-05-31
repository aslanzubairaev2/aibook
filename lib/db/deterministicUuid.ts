/**
 * Generates a valid and deterministic UUID v4-like string from any input string.
 * This ensures that seeding the same content multiple times produces the exact same ID,
 * preventing duplication and foreign key violations in reading progress.
 */
export function getDeterministicUUID(str: string): string {
  let hash1 = 0, hash2 = 0, hash3 = 0, hash4 = 0;
  
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash1 = (hash1 * 31 + ch) & 0xffffffff;
    hash2 = (hash2 * 37 + ch) & 0xffffffff;
    hash3 = (hash3 * 41 + ch) & 0xffffffff;
    hash4 = (hash4 * 43 + ch) & 0xffffffff;
  }

  const hex = (val: number) => {
    const s = (val >>> 0).toString(16);
    return "00000000".slice(s.length) + s;
  };

  const part1 = hex(hash1);
  const part2 = hex(hash2).slice(0, 4);
  const part3 = hex(hash2).slice(4, 8);
  const part4 = hex(hash3).slice(0, 4);
  const part5 = hex(hash3).slice(4, 8) + hex(hash4).slice(0, 8);

  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}
