import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';

export interface SessionUser {
  userId: number;
  username: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = (req as any).session;
  if (session && session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
