import React, { useMemo, useRef, useEffect, useState } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import { motion } from 'framer-motion';
import { ImageCard } from './ImageCard';
import { ProjectImage } from '@/types';

interface VirtualizedImageGridProps {
  images: ProjectImage[];
  onDelete: (imageId: string) => void;
  onOpen: (imageId: string) => void;
  selectedImageIds: Set<string>;
  onSelectionChange: (imageId: string, selected: boolean) => void;
  containerHeight?: number;
}

// Grid item dimensions
const ITEM_WIDTH = 266; // 250px + 16px gap
const ITEM_HEIGHT = 183; // 167px + 16px gap
const GAP = 16;

interface GridItemProps {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  data: {
    images: ProjectImage[];
    columnsPerRow: number;
    onDelete: (imageId: string) => void;
    onOpen: (imageId: string) => void;
    selectedImageIds: Set<string>;
    onSelectionChange: (imageId: string, selected: boolean) => void;
  };
}

const GridItem: React.FC<GridItemProps> = ({ columnIndex, rowIndex, style, data }) => {
  const { images, columnsPerRow, onDelete, onOpen, selectedImageIds, onSelectionChange } = data;
  const imageIndex = rowIndex * columnsPerRow + columnIndex;
  const image = images[imageIndex];

  if (!image) {
    return <div style={style} />;
  }

  return (
    <div
      style={{
        ...style,
        left: (style.left as number) + GAP / 2,
        top: (style.top as number) + GAP / 2,
        width: (style.width as number) - GAP,
        height: (style.height as number) - GAP,
      }}
    >
      <ImageCard
        image={image}
        onDelete={onDelete}
        onOpen={onOpen}
        isSelected={selectedImageIds.has(image.id)}
        onSelectionChange={onSelectionChange}
      />
    </div>
  );
};

export const VirtualizedImageGrid: React.FC<VirtualizedImageGridProps> = ({
  images,
  onDelete,
  onOpen,
  selectedImageIds,
  onSelectionChange,
  containerHeight = 600,
}) => {
  const gridRef = useRef<Grid>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Calculate container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Calculate grid dimensions
  const { columnsPerRow, rowCount } = useMemo(() => {
    if (containerWidth === 0) return { columnsPerRow: 1, rowCount: images.length };

    const cols = Math.max(1, Math.floor(containerWidth / ITEM_WIDTH));
    const rows = Math.ceil(images.length / cols);

    return {
      columnsPerRow: cols,
      rowCount: rows,
    };
  }, [containerWidth, images.length]);

  // Grid data for react-window
  const itemData = useMemo(
    () => ({
      images,
      columnsPerRow,
      onDelete,
      onOpen,
      selectedImageIds,
      onSelectionChange,
    }),
    [images, columnsPerRow, onDelete, onOpen, selectedImageIds, onSelectionChange]
  );

  return (
    <motion.div
      ref={containerRef}
      className="w-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {containerWidth > 0 && (
        <Grid
          ref={gridRef}
          height={containerHeight}
          width={containerWidth}
          columnCount={columnsPerRow}
          columnWidth={ITEM_WIDTH}
          rowCount={rowCount}
          rowHeight={ITEM_HEIGHT}
          itemData={itemData}
          overscanRowCount={2}
          overscanColumnCount={2}
        >
          {GridItem}
        </Grid>
      )}
    </motion.div>
  );
};