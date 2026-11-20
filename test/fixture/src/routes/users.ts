import { Router } from 'express';
import * as ctrl from '../controllers/users';

const router = Router();
router.get('/', ctrl.list);
router.get('/:id', ctrl.show);
router.route('/:id/avatar').put(ctrl.upload).delete(ctrl.removeAvatar);
export default router;
