import { Router } from 'express';
import {
  chatWithBaristaController,
  getBaristaRecommendationsController,
} from '../../controllers/ai.controller';

const router = Router();

router.post('/chat', chatWithBaristaController);
router.get('/recommendations', getBaristaRecommendationsController);

export default router;
