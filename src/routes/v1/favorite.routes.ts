import { Router } from 'express';
import { getFavorites, toggleFavorite } from '../../controllers/favorite.controller';
import { customerAuth } from '../../middlewares/customerAuth.middleware';

const router = Router();

router.get('/', customerAuth, getFavorites);
router.post('/toggle', customerAuth, toggleFavorite);

export default router;
