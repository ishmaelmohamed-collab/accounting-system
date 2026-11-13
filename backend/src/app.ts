import express from 'express';
import session from 'express-session';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { pool } from './db';
import { config } from './config';
import { logger } from './logger';
import authRoutes from './routes/auth';
import apiRoutes from './routes/api';
import pageRoutes from './routes/pages';

const connectPgSimpleFactory = require('connect-pg-simple');
const pgSession = connectPgSimpleFactory(session);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Structured request logging
app.use(pinoHttp({ logger }));

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

// Rate limiting: stricter for login, general for the rest of the API
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later.' },
});

app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/', pageRoutes);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'unhandled error');
  res.status(500).json({ error: err.message || 'Internal server error' });
});

export default app;
