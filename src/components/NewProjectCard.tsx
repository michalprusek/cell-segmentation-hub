
import React, { useState } from 'react';
import { Dialog, DialogContent } from "@/components/ui/dialog";
import NewProjectCardUI from '@/components/project/NewProjectCardUI';
import ProjectDialogForm from '@/components/project/ProjectDialogForm';

interface NewProjectCardProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NewProjectCard = ({ isOpen, onOpenChange }: NewProjectCardProps) => {
  const [open, setOpen] = useState(false);
  
  // Determine if the dialog is open using internal or external state
  const isDialogOpen = isOpen !== undefined ? isOpen : open;
  
  // Function to set the dialog state that respects external and internal state
  const setDialogOpen = (newOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(newOpen);
    }
    setOpen(newOpen);
  };

  // Handle dialog close
  const handleClose = () => {
    setDialogOpen(false);
  };

  // If we're using the component as a card
  if (onOpenChange === undefined) {
    return (
      <>
        <NewProjectCardUI onClick={() => setDialogOpen(true)} />

        <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <ProjectDialogForm onClose={handleClose} />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // If we're only using the dialog
  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <ProjectDialogForm onClose={handleClose} />
      </DialogContent>
    </Dialog>
  );
};

export default NewProjectCard;
