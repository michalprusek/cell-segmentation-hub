import { Router, Request, Response, NextFunction } from 'express';
import {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  previewFolder,
  moveProjectsToFolder,
} from '../controllers/projectFolderController';
import { authenticate } from '../../middleware/auth';
import {
  validateBody,
  validateParams,
} from '../../middleware/validation';
import {
  createFolderSchema,
  updateFolderSchema,
  folderItemsSchema,
  folderIdSchema,
} from '../../types/validation';

const router = Router();

// All folder routes require authentication. The router is mounted at
// /api/folders in setupRoutes() so paths below are relative to that.
router.use(authenticate);

router.get('/', listFolders);

router.post('/', validateBody(createFolderSchema), createFolder);

router.patch(
  '/:id',
  validateParams(folderIdSchema),
  validateBody(updateFolderSchema),
  updateFolder
);

router.delete('/:id', validateParams(folderIdSchema), deleteFolder);

router.get('/:id/preview', validateParams(folderIdSchema), previewFolder);

// Move projects into a folder. Two variants:
//   POST /api/folders/root/items        — pull selection back to root (no placement row)
//   POST /api/folders/:id/items         — push selection into a folder owned by the caller
// They share a controller; the router decides which by branching the path so each
// route's :id param is either a valid uuid or absent (no need for a uuid|"root" union schema).
router.post(
  '/root/items',
  validateBody(folderItemsSchema),
  (req: Request, _res: Response, next: NextFunction) => {
    req.params.id = 'root';
    next();
  },
  moveProjectsToFolder
);

router.post(
  '/:id/items',
  validateParams(folderIdSchema),
  validateBody(folderItemsSchema),
  moveProjectsToFolder
);

export default router;
