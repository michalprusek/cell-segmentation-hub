# WebSocket events

Real-time updates use **Socket.io** on the same origin as the REST API. The
client connects once after sign-in and stays connected, with automatic
reconnection and exponential backoff.

---

## Connecting and subscribing

Authentication rides on the session — the socket handshake carries the auth
cookie. An unauthenticated socket is allowed to connect but is refused when it
tries to join a project room, receiving an `unauthorized` event.

Two room scopes:

| Room                  | Joined                                         | Receives                          |
| --------------------- | ---------------------------------------------- | --------------------------------- |
| `user:<userId>`       | Automatically on authenticated connect         | Everything addressed to this user |
| `project:<projectId>` | By emitting `join-project` with the project id | Project-wide broadcasts           |

Emit `leave-project` with the project id to unsubscribe.

Segmentation updates are emitted to the **user** room only, deliberately, to
avoid delivering the same event twice to a client that is in both rooms.

---

## Events the server emits

### Connection

| Event                 | Payload                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `connectionStatus`    | `{ status: 'connected' \| 'disconnected' \| 'reconnecting', userId?, timestamp, reconnectAttempt?, maxReconnectAttempts? }` |
| `unauthorized`        | `{ message }` — sent when an unauthenticated socket tries to join a project                                                 |
| `authenticationError` | Authentication failed during the handshake                                                                                  |

### Segmentation

| Event                   | Meaning                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `segmentationStatus`    | An image's status changed (`queued` → `processing` → `segmented` / `failed`) |
| `segmentation-update`   | A richer update for one image                                                |
| `segmentationProgress`  | Progress within a running segmentation                                       |
| `segmentationCompleted` | An image finished successfully                                               |
| `segmentationFailed`    | An image failed, with the error                                              |

### Queue

| Event               | Meaning                                          |
| ------------------- | ------------------------------------------------ |
| `queueStats`        | Current queue depth and throughput for a project |
| `queuePosition`     | This item's position                             |
| `queueUpdate`       | An item was added, removed or re-prioritised     |
| `queue-stats-error` | The stats request failed                         |

### Upload

`uploadProgress`, `uploadCompleted`, `uploadFailed`.

### Export

| Event                  | Meaning                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `export:started`       | The job was accepted                                                                                                    |
| `export:progress`      | Percentage and current stage                                                                                            |
| `export:phase-changed` | The stage changed (images, visualizations, annotations, metrics, mt-metrics, kymographs, imagej-roi, cvat, compression) |
| `export:completed`     | Finished; the payload carries any **warnings** from non-fatal stage failures                                            |
| `export:failed`        | Failed, with the error                                                                                                  |
| `export:cancelled`     | Cancelled                                                                                                               |
| `export:cancel-error`  | The cancel request itself failed                                                                                        |

> The export dialog **also polls** `/status` every 2 s. A dropped socket
> therefore never strands an export — and completion of a resegment is detected
> by polling rather than by these events, on purpose.

### Project and dashboard

`projectUpdate`, `projectDeleted`, `dashboardUpdate`, `thumbnail:updated`,
`concurrent-user-count`.

### Sharing

`shareReceived`, `shareAccepted`, `shareRejected`.

### Operations and system

`operation:cancel-ack`, `operation:cancel-error`,
`parallel-processing-status`, `processing-stream-update`, `system-message`,
`notification`.

### Errors

`error`, `validationError`.

---

## Events the client emits

| Event           | Payload     | Purpose                                                |
| --------------- | ----------- | ------------------------------------------------------ |
| `join-project`  | `projectId` | Subscribe to a project's room. Requires authentication |
| `leave-project` | `projectId` | Unsubscribe                                            |
| `authenticate`  | —           | Re-authenticate an existing socket                     |

---

## Reliability notes

- The client reconnects indefinitely with exponential backoff, re-mints the auth
  cookie if needed, and reconnects on the browser's `online` and
  `visibilitychange` events.
- **Room membership is not restored automatically by Socket.io** on reconnect —
  the client re-joins its project room itself.
- Treat WebSocket events as an **optimisation, not a guarantee**. Every flow
  that depends on knowing something finished also has an HTTP path: the export
  dialog polls, and the editor's resegment detection polls the segmentation
  result's `updatedAt`. If you are building on this API, do the same.

## Related

- [REST API](README.md)
- [Backend architecture](../architecture/backend.md)
