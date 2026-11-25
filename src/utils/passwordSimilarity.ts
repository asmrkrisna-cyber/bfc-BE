import bcrypt from 'bcryptjs';

export type PasswordSimilarityStatus = 'distinct' | 'similar' | 'identical';

function isBcryptHash(value: string): boolean {
  return value.startsWith('$2a$') || value.startsWith('$2b$') || value.startsWith('$2y$');
}

function stripTrailingSymbolsAndDigits(value: string): string {
  return value.replace(/[\d\W_]+$/g, '');
}

function normalizeLettersAndDigits(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Verifikasi kecocokan kata sandi plaintext terhadap nilai tersimpan (bcrypt atau legacy plaintext).
 */
export async function verifyStoredPassword(
  candidatePlain: string,
  storedPassword: string | null | undefined
): Promise<boolean> {
  if (!storedPassword) return false;
  if (isBcryptHash(storedPassword)) {
    return bcrypt.compare(candidatePlain, storedPassword);
  }
  return candidatePlain === storedPassword;
}

/**
 * Evaluasi kemiripan antara kata sandi lama dan baru (ketika kedua plaintext tersedia).
 */
export function comparePlaintextPasswordSimilarity(
  oldPassword: string,
  newPassword: string
): PasswordSimilarityStatus {
  if (!oldPassword || !newPassword) return 'distinct';
  if (oldPassword === newPassword) return 'identical';

  const oldLower = oldPassword.toLowerCase();
  const newLower = newPassword.toLowerCase();
  if (oldLower === newLower) return 'similar';

  const oldCore = normalizeLettersAndDigits(stripTrailingSymbolsAndDigits(oldPassword));
  const newCore = normalizeLettersAndDigits(stripTrailingSymbolsAndDigits(newPassword));
  if (oldCore.length >= 4 && oldCore === newCore) {
    return 'similar';
  }

  const maxLen = Math.max(oldLower.length, newLower.length);
  const dist = levenshteinDistance(oldLower, newLower);
  const similarity = 1 - dist / maxLen;
  if (similarity >= 0.7 || dist <= 2) {
    return 'similar';
  }

  if (oldLower.length >= 5 && newLower.length >= 5) {
    if (oldLower.includes(newLower) || newLower.includes(oldLower)) {
      const ratio = Math.min(oldLower.length, newLower.length) / maxLen;
      if (ratio >= 0.65) return 'similar';
    }
  }

  return 'distinct';
}

function buildNearPasswordCandidates(newPassword: string): string[] {
  const candidates = new Set<string>();
  const add = (val: string) => {
    if (val && val !== newPassword && val.length >= 4) {
      candidates.add(val);
    }
  };

  add(newPassword.toLowerCase());
  add(newPassword.toUpperCase());
  add(newPassword[0].toUpperCase() + newPassword.slice(1).toLowerCase());
  add(newPassword[0].toLowerCase() + newPassword.slice(1));

  // Variasi hapus 1-2 karakter terakhir atau simbol/angka di ujung
  if (newPassword.length > 5) {
    add(newPassword.slice(0, -1));
    add(newPassword.slice(0, -2));
  }
  const withoutTrailingSymbols = newPassword.replace(/[!@#$%^&*_.\-]+$/g, '');
  add(withoutTrailingSymbols);
  add(withoutTrailingSymbols.toLowerCase());

  // Variasi ubah angka terakhir +/- 1 (mis. kopi2024 <-> kopi2025, sandi123 <-> sandi124)
  const trailingDigitMatch = newPassword.match(/^(.*?)(\d)$/);
  if (trailingDigitMatch) {
    const prefix = trailingDigitMatch[1];
    const d = Number(trailingDigitMatch[2]);
    add(`${prefix}${(d + 1) % 10}`);
    add(`${prefix}${(d + 9) % 10}`);
  }

  // Variasi tambahan karakter singkat yang umum jika sandi sebelumnya lebih pendek
  for (const suffix of ['1', '!', '123', '@']) {
    add(`${newPassword}${suffix}`);
  }

  return Array.from(candidates).slice(0, 12);
}

/**
 * Mengecek apakah kata sandi baru sama persis atau hampir sama dengan kata sandi tersimpan (hash bcrypt).
 */
export async function checkHashedPasswordSimilarity(
  storedPassword: string | null | undefined,
  newPassword: string
): Promise<PasswordSimilarityStatus> {
  if (!storedPassword) return 'distinct';

  if (!isBcryptHash(storedPassword)) {
    return comparePlaintextPasswordSimilarity(storedPassword, newPassword);
  }

  if (await bcrypt.compare(newPassword, storedPassword)) {
    return 'identical';
  }

  const candidates = buildNearPasswordCandidates(newPassword);
  for (const candidate of candidates) {
    if (await bcrypt.compare(candidate, storedPassword)) {
      return 'similar';
    }
  }

  return 'distinct';
}
