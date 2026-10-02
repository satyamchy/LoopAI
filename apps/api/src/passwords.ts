import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => {
      if (error) reject(error);
      else resolve(`${salt}.${key.toString("base64url")}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(".");
  if (!salt || !key) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, next) => {
      if (error) reject(error);
      else {
        const expected = Buffer.from(key, "base64url");
        resolve(expected.length === next.length && timingSafeEqual(expected, next));
      }
    });
  });
}
