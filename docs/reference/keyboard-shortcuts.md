# Keyboard shortcuts

Every keyboard binding in the app, in one place. All shortcuts are ignored while
the focus is in a text field.

Press <kbd>H</kbd> or <kbd>?</kbd> in the editor for the in-app dialog. Note that
the dialog is incomplete — this page is the full list, taken from the code.

---

## Segmentation editor — modes

| Key                             | Action                                  | Requires                    |
| ------------------------------- | --------------------------------------- | --------------------------- |
| <kbd>V</kbd>                    | View mode                               | —                           |
| <kbd>E</kbd>                    | Edit vertices                           | a selected shape            |
| <kbd>A</kbd>                    | Add points                              | a selected shape            |
| <kbd>N</kbd>                    | Create polygon                          | —                           |
| <kbd>P</kbd>                    | Create polyline                         | —                           |
| <kbd>S</kbd>                    | Slice                                   | — (**no selection needed**) |
| <kbd>D</kbd>                    | Delete polygon mode                     | —                           |
| <kbd>Tab</kbd>                  | Next edit mode                          | —                           |
| <kbd>Shift</kbd>+<kbd>Tab</kbd> | Previous edit mode                      | —                           |
| <kbd>Esc</kbd>                  | Cancel, return to View, clear selection | —                           |

The <kbd>Tab</kbd> cycle is View → Create polygon → Create polyline → Slice →
Delete polygon, and back. When a shape is selected, Edit vertices and Add points
are inserted after View.

## Segmentation editor — actions

| Key                                           | Action                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>                  | Undo                                                               |
| <kbd>Ctrl</kbd>+<kbd>Y</kbd>                  | Redo                                                               |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Redo                                                               |
| <kbd>Ctrl</kbd>+<kbd>S</kbd>                  | Save                                                               |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd>      | Delete the selected shape (View, Edit vertices or Delete mode)     |
| <kbd>Enter</kbd>                              | Finish the polyline being drawn, or commit an Add-points extension |
| <kbd>H</kbd> / <kbd>?</kbd>                   | Keyboard help                                                      |

On macOS <kbd>Cmd</kbd> works wherever <kbd>Ctrl</kbd> is listed.

## Segmentation editor — view

| Key                                            | Action                     |
| ---------------------------------------------- | -------------------------- |
| <kbd>+</kbd> / <kbd>=</kbd>                    | Zoom in (canvas centre)    |
| <kbd>−</kbd> / <kbd>_</kbd>                    | Zoom out (canvas centre)   |
| <kbd>R</kbd> / <kbd>0</kbd>                    | Reset view — fit the image |
| Mouse wheel                                    | Zoom around the pointer    |
| Hold <kbd>Space</kbd> or <kbd>Alt</kbd> + drag | Pan, in any mode           |
| Middle-mouse drag                              | Pan, in any mode           |

## Segmentation editor — video frames

| Key              | Action                                               |
| ---------------- | ---------------------------------------------------- |
| <kbd>←</kbd>     | Previous frame                                       |
| <kbd>→</kbd>     | Next frame                                           |
| <kbd>Space</kbd> | Play / pause (fixed 10 fps, stops at the last frame) |

> <kbd>Space</kbd> is handled twice: it toggles playback **and** arms
> pan-on-drag. That is intentional but can surprise you if you hold it while
> dragging.

## Segmentation editor — modifiers

| Modifier                                           | Effect                                       |
| -------------------------------------------------- | -------------------------------------------- |
| <kbd>Shift</kbd> + click a shape                   | Toggle it in the multi-selection             |
| <kbd>Shift</kbd> + click a vertex (Edit vertices)  | Switch to Add points anchored on that vertex |
| <kbd>Shift</kbd> held while moving (drawing modes) | Drop points automatically every ~10 px       |
| Right-click a vertex                               | Delete vertex                                |
| Right-click a shape                                | Context menu                                 |
| Right-click empty canvas                           | Step back one stage, then return to View     |

---

## Segmenter (few-shot tool)

| Key                                                                          | Action                         |
| ---------------------------------------------------------------------------- | ------------------------------ |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd>                                     | Delete the selected polygon    |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>                                                 | Undo                           |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo                           |
| <kbd>Ctrl</kbd>+<kbd>S</kbd>                                                 | Save                           |
| <kbd>Enter</kbd>                                                             | Close the polygon being drawn  |
| <kbd>Esc</kbd>                                                               | Cancel the polygon being drawn |

---

## Documentation page

| Key            | Action                             |
| -------------- | ---------------------------------- |
| <kbd>/</kbd>   | Focus the documentation search box |
| <kbd>Esc</kbd> | Clear the search                   |

## Related

- [Segmentation editor](../guides/segmentation-editor.md)
- [Segmenter](../guides/segmenter.md)
