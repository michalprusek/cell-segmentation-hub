# Sharing and collaboration

How to give someone else access to a project, and exactly what they can do with
it.

---

## Two ways to share

Open a project → **Share**.

### By e-mail

Enter the recipient's address. An invitation is created immediately and an
e-mail is sent in the background carrying an accept link. The share exists and
the link works **whether or not the e-mail arrives** — mail delivery is
best-effort and the institutional mail server routinely takes 2–10 minutes.

You cannot share a project with yourself, and you cannot send a second
invitation to someone who has already accepted (re-sending a still-pending one
is fine).

### By link

Generates a share token you can pass on by any channel. The link stays
**pending** until someone opens and accepts it, at which point it binds to that
account.

Links can carry an expiry. An expired token is marked as such and stops working.

---

## Accepting

The recipient opens `/share/accept/<token>`. If they are signed in, the project
appears in their dashboard immediately. If not, they are asked to sign in or
sign up first — sign-up is open, so no administrator is involved.

Accepted shares appear in the recipient's project list alongside their own
projects, and each user can file them into their **own** folder tree
independently: two people can keep the same shared project in differently named
folders.

---

## What a collaborator can do

| Action                                        | Owner | Accepted collaborator |
| --------------------------------------------- | :---: | :-------------------: |
| View the project and its images               |  ✅   |          ✅           |
| Open the segmentation editor                  |  ✅   |          ✅           |
| **Edit and save annotations**                 |  ✅   |          ✅           |
| Run segmentation, resegment                   |  ✅   |          ✅           |
| Export                                        |  ✅   |          ✅           |
| Mark the project **verified**                 |  ✅   |          ✅           |
| File it in their own folders                  |  ✅   |          ✅           |
| Change title, description or **project type** |  ✅   |          ❌           |
| Share it with others, or revoke a share       |  ✅   |          ❌           |
| Delete the project                            |  ✅   |          ❌           |

> **Sharing is collaborative, not read-only.** An accepted collaborator can
> change annotations, and on a video their edits carry the same cross-frame
> consequences as the owner's — deleting a tracked polyline and saving removes
> it from every frame. Share with people you want annotating, and use **revoke**
> when that stops being true.

The **verified** flag ("all annotations reviewed and passed") is deliberately
settable by collaborators as well as the owner — it is a review signal, and the
reviewer is usually not the owner. Who set it and when is recorded, though not
currently shown in the interface.

---

## Managing and revoking

The share dialog lists every share on the project with its status —
**pending**, **accepted**, **revoked** or **expired** — with accepted ones
first.

**Revoking** takes effect immediately: the project disappears from the other
user's dashboard and their access checks start failing. Nothing they have
already exported is affected, and annotations they made stay in the project.

---

## Privacy note

Frame images and the image display endpoint are served **without
authentication** — anyone holding an image's UUID can fetch its pixels. This is
a deliberate trade-off (a browser `<img>` tag cannot carry an auth token), and
the UUID is the capability. It means a _link to an image_ is effectively a share
of that image, so treat image URLs as you would a share link.

## Related

- [User guide](user-guide.md)
- [REST API → sharing](../api/README.md#sharing)
