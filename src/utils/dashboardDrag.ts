// HTML5 native DnD helpers for the dashboard's file-explorer drag-and-drop.
//
// Why not @dnd-kit? Its sensors call event.preventDefault() on pointerdown
// to block native drag selection. That preventDefault also suppresses the
// browser's subsequent click event — so cards using @dnd-kit listeners
// stop being clickable. HTML5 native drag and click are independent event
// chains, so cards stay both clickable AND draggable.
//
// Why dataTransfer-based and not a shared module-level ref?
// During the dragover phase the browser hides dataTransfer.getData() return
// values for security (the receiver shouldn't be able to peek at payload
// before the user commits to the drop). However the *list* of MIME types
// IS exposed during dragover via dataTransfer.types — so we encode the
// dragged item's *type* in the MIME and read the *id* only at drop time.
//
// MIME conventions:
//   application/x-spheroseg-project   payload: project uuid
//   application/x-spheroseg-folder    payload: folder uuid
// The `x-spheroseg-` prefix prevents accidental matches with files dragged
// in from the desktop (e.g. text/plain, Files).

export type DragItem =
  | { type: 'project'; id: string }
  | { type: 'folder'; id: string };

export const PROJECT_MIME = 'application/x-spheroseg-project';
export const FOLDER_MIME = 'application/x-spheroseg-folder';

/** Props for a drag source. Spread onto the draggable element. */
export function dragSourceProps(item: DragItem): {
  draggable: true;
  onDragStart: (e: React.DragEvent) => void;
} {
  const mime = item.type === 'project' ? PROJECT_MIME : FOLDER_MIME;
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      // Set BOTH a structured MIME (read on drop) and text/plain
      // (some browsers — Firefox in particular — refuse to initiate a
      // drag without a text/plain payload).
      e.dataTransfer.setData(mime, item.id);
      e.dataTransfer.setData('text/plain', `${item.type}:${item.id}`);
    },
  };
}

/** What type of item is currently being dragged, derived from dataTransfer
 *  types? Available even during dragover (when getData itself returns ""). */
export function dragKindFromTypes(
  types: ReadonlyArray<string>
): DragItem['type'] | null {
  if (types.includes(PROJECT_MIME)) return 'project';
  if (types.includes(FOLDER_MIME)) return 'folder';
  return null;
}

/** Read the actual payload at drop time (getData() works now). */
export function readDragItem(dataTransfer: DataTransfer): DragItem | null {
  const project = dataTransfer.getData(PROJECT_MIME);
  if (project) return { type: 'project', id: project };
  const folder = dataTransfer.getData(FOLDER_MIME);
  if (folder) return { type: 'folder', id: folder };
  return null;
}

/** Should the current dragover be accepted onto a folder target? */
export function shouldAcceptOnFolder(
  targetFolderId: string,
  dataTransfer: DataTransfer
): boolean {
  const kind = dragKindFromTypes(Array.from(dataTransfer.types));
  if (!kind) return false;
  // We cannot peek the source id during dragover, so we'd allow a
  // self-drop here; the drop handler filters it (folder !== self).
  return true;
}

/** Should the current dragover be accepted onto a breadcrumb segment? */
export function shouldAcceptOnBreadcrumb(dataTransfer: DataTransfer): boolean {
  return dragKindFromTypes(Array.from(dataTransfer.types)) !== null;
}
