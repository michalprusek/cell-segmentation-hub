import React, { useState } from 'react';
import { useLanguage } from '@/contexts/useLanguage';

interface ProjectThumbnailProps {
  /** The project's card picture: the server's versioned preview of the
   *  image the project grid shows first (`project.previewUrl`). */
  src: string | null | undefined;
}

const PLACEHOLDER = '/placeholder.svg';

/**
 * A dashboard card's picture.
 *
 * It used to fetch `GET /projects/<id>/images?limit=1` per card on mount and
 * show that image's RAW upload thumbnail — so a project's card never showed
 * its segmentation, and changed only when the image COUNT changed. The
 * project list now carries `previewUrl` (same versioned preview as the grid),
 * so a card costs one cached image request and follows every edit.
 */
const ProjectThumbnail = ({ src }: ProjectThumbnailProps) => {
  const { t } = useLanguage();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = src && src !== failedSrc ? src : PLACEHOLDER;

  return (
    <img
      src={shown}
      alt={t('common.project')}
      loading="lazy"
      onError={() => {
        if (shown !== PLACEHOLDER) setFailedSrc(shown);
      }}
      className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
    />
  );
};

export default React.memo(ProjectThumbnail);
