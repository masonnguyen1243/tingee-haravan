import { Router } from 'express';
import path from 'path';

const router = Router();
const publicDir = path.join(__dirname, '..', '..', 'public');

router.get('/install', (_req, res) => {
  res.sendFile(path.join(publicDir, 'install.html'));
});

router.get('/setup', (_req, res) => {
  res.sendFile(path.join(publicDir, 'setup.html'));
});

router.get('/pay', (_req, res) => {
  res.sendFile(path.join(publicDir, 'pay.html'));
});

router.get('/', (_req, res) => {
  res.redirect('/install');
});

export default router;
