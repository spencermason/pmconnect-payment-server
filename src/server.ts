import './utils/env';

import express from 'express';

import routes from './routes';
import './utils/parse';

const server = express();

server.use(routes);

server.listen(3000, () => console.log('express server started'));
