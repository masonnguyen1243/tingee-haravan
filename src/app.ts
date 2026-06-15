import express from 'express';
import path from 'path';
import configRouter from './routes/config';
import paymentRouter from './routes/payment';
import webhookRouter from './routes/webhook';
import pagesRouter from './routes/pages';

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/config', configRouter);
app.use('/api/payments', paymentRouter);
app.use('/webhook/tingee', webhookRouter);
app.use('/', pagesRouter);

export default app;
