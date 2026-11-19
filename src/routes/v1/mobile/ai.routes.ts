import { Router } from 'express';
import { handleBaristaChat } from '../../../controllers/mobile/ai.controller';

const router = Router();

router.post('/message', handleBaristaChat);

export default router;
