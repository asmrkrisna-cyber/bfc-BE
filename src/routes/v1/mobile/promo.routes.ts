import { Router } from 'express';
import { getActivePromos, validatePromo } from '../../../controllers/mobile/promo.controller';

const router = Router();

router.get('/active', getActivePromos);
router.post('/validate', validatePromo);

export default router;
