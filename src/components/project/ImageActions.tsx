
import React from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ImageActionsProps {
  onDelete: () => void;
}

const ImageActions = ({ onDelete }: ImageActionsProps) => {
  return (
    <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        variant="destructive"
        size="icon"
        className="h-7 w-7"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default ImageActions;
