import express from 'express';
import { query } from '../db';
import { verifyPassword } from '../auth';

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    const { rows } = await query(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username],
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    (req as any).session.userId = user.id;
    (req as any).session.username = user.username;
    (req as any).session.role = user.role;
    return res.json({ ok: true, username: user.username, role: user.role });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if ((req as any).session.userId) {
    return res.json({ username: (req as any).session.username });
  }
  return res.status(401).json({ error: 'Not authenticated' });
});

export default router;
