import { Router } from 'express';
import { validatePromo } from '../../../controllers/mobile/promo.controller';

const router = Router();

router.post('/validate', validatePromo);

export default router;
