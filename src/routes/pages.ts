import { Router } from 'express';
import path from 'path';

const router = Router();
const publicDir = path.join(__dirname, '..', '..', 'public');

router.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'setup.html'));
});

router.get('/pay', (_req, res) => {
  res.sendFile(path.join(publicDir, 'pay.html'));
});

export default router;
