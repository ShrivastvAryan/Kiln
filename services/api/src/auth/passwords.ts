import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP-recommended parameters (19 MiB memory, 2 iterations).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * A real hash to verify against when the email doesn't exist, so "no such user" and
 * "wrong password" take the same time and can't be told apart by timing.
 */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword('kiln-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}
