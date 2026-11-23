import { Router } from 'express';
import { handleBaristaChat } from '../../../controllers/mobile/ai.controller';
import {
  chatWithBaristaController,
  getBaristaRecommendationsController,
} from '../../../controllers/ai.controller';

const router = Router();

router.post('/message', handleBaristaChat);
router.post('/chat', chatWithBaristaController);
router.get('/recommendations', getBaristaRecommendationsController);

export default router;
