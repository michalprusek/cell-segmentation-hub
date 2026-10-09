import * as os from 'os';
import * as path from 'path';

/** Where the video multer streams an upload before anything has looked at it.
 *  A module of its own so code that later receives such a path can check it
 *  lies here without importing the multer set-up and its side effects. */
export const VIDEO_UPLOAD_TMP_DIR =
  process.env.VIDEO_UPLOAD_TMP_DIR ??
  path.join(os.tmpdir(), 'spheroseg-uploads');
