# E2E video fixtures

Small synthetic videos used by the Playwright microtubule + video
workflow specs. Kept tiny (~2 KB) so the repo doesn't grow with binary
test data.

## `short_mt.mp4`

128 × 96, 5 fps, 1 second (5 frames), h264 / yuv420p. Black background
with a frame-number watermark — the goal is not to test the microtubule
model on this fixture (it has no filaments) but to exercise the upload

- extraction + frame-navigation pipeline.

The microtubule model is run against synthetic fixtures generated
in-process by the corresponding ML pytest, not against this MP4.

### Regenerating

The repo's dev environment doesn't ship a system `ffmpeg`. Use the
official ffmpeg container image to regenerate the fixture without
adding a host dependency:

```bash
docker run --rm \
  -v $(pwd)/tests/fixtures/video:/out \
  linuxserver/ffmpeg \
  -y -f lavfi \
  -i "color=size=128x96:rate=5:color=gray:duration=1,drawtext=text='%{n}':fontcolor=white:fontsize=24:x=(w-tw)/2:y=(h-th)/2" \
  -pix_fmt yuv420p -c:v libx264 -movflags +faststart \
  /out/short_mt.mp4
```

## Running the spec

The spec auto-skips when the fixture is absent or `E2E_USER_EMAIL` is
not set in env. To run it locally:

```bash
export E2E_USER_EMAIL=<test user>
export E2E_USER_PASSWORD=<test password>
export HF_TOKEN=<your gated DINOv3 token>   # required by ML container
make test-e2e -- microtubule-video-workflow
```
