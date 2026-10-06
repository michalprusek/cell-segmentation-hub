import { Router } from 'express';
import * as apiKeyController from '../controllers/apiKeyController';
import { authenticate } from '../../middleware/auth';
import { apiKeyCreateLimiter } from '../../middleware/rateLimiter';
import { validateBody, validateParams } from '../../middleware/validation';
import { apiKeyIdSchema, createApiKeySchema } from '../../types/validation';

const router = Router();

// Managing keys is done from the app, with the session cookie. It is
// deliberately NOT reachable with an API key: a leaked key must not be able
// to mint its own replacements or revoke the owner's other keys.
router.use(authenticate);

router.get('/', apiKeyController.list);

router.post(
  '/',
  apiKeyCreateLimiter,
  validateBody(createApiKeySchema),
  apiKeyController.create
);

router.delete('/:id', validateParams(apiKeyIdSchema), apiKeyController.remove);

export default router;
