import './utils/env';
import './utils/parse';

import express, { Request, Response, NextFunction, Errback } from 'express';

import routes from './routes';

const server = express();
server.use(routes);
server.listen(3000, () => console.log('express server started'));
server.use((error: any, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof Error) {
    console.error(error.stack);
    console.error(error.message);
  }
  return res
    .status(error.status || error.statusCode || 500)
    .send(error.message || 'Internal Server Error');
});
