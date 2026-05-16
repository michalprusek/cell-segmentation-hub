import { useEffect, useState } from 'react';
import { useImageDisplay } from '../../contexts/ImageDisplayContext';
import EditorFrameLoadingOverlay from './EditorFrameLoadingOverlay';

interface FrameLoadingGateProps {
  imageId: string | null;
  loadedFrameKey: string | null;
  isVideoMode: boolean;
  width?: number;
  height?: number;
  label?: string;
}

// Lives inside ImageDisplayProvider so it can read visibleChannels —
// the overlay must track BOTH frame id and channel set, otherwise a
// channel toggle on the same frame would never re-arm the overlay
// even while the new channel PNG is still decoding.
export default function FrameLoadingGate({
  imageId,
  loadedFrameKey,
  isVideoMode,
  width,
  height,
  label,
}: FrameLoadingGateProps) {
  const { visibleChannels, channel } = useImageDisplay();
  const channelsKey =
    visibleChannels.length > 0 ? visibleChannels.join('|') : (channel ?? '');
  const targetFrameKey = imageId ? `${imageId}::${channelsKey}` : null;

  const [show, setShow] = useState(false);
  useEffect(() => {
    const mismatched =
      isVideoMode && !!targetFrameKey && loadedFrameKey !== targetFrameKey;
    if (!mismatched) {
      setShow(false);
      return;
    }
    // 150 ms grace — cache hits and warm-network loads finish first.
    const timer = window.setTimeout(() => setShow(true), 150);
    return () => window.clearTimeout(timer);
  }, [isVideoMode, targetFrameKey, loadedFrameKey]);

  return (
    <EditorFrameLoadingOverlay
      visible={show}
      width={width}
      height={height}
      label={label}
    />
  );
}
