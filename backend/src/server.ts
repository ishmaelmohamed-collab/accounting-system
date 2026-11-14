import app from './app';
import { config } from './config';
import { logger } from './logger';

app.listen(config.port, config.host, () => {
  logger.info(`Accounting backend listening on http://${config.host}:${config.port}`);
});
