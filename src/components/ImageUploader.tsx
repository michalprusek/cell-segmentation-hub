
import React, { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { uploadImage } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from '@/contexts/LanguageContext';
import DropZone from "@/components/upload/DropZone";
import FileList, { FileWithPreview } from "@/components/upload/FileList";
import UploaderOptions from "@/components/upload/UploaderOptions";

const ImageUploader = () => {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [autoSegment, setAutoSegment] = useState(true); // Default to true
  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const { t } = useLanguage();
  const currentProjectId = params.id;

  useEffect(() => {
    if (currentProjectId) {
      setProjectId(currentProjectId);
    }
  }, [currentProjectId]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (!projectId) {
      toast.error(t('images.selectProjectFirst'));
      return;
    }

    const newFiles = acceptedFiles.map(file => 
      Object.assign(file, {
        preview: URL.createObjectURL(file),
        uploadProgress: 0,
        status: "pending" as const
      })
    );
    
    setFiles(prev => [...prev, ...newFiles]);
    
    if (projectId && user) {
      handleUpload(newFiles, projectId, user.id);
    }
  }, [projectId, user, t]);

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': [],
      'image/png': [],
      'image/tiff': [],
      'image/bmp': []
    },
    maxSize: 10485760,
    disabled: !projectId, // Disable dropzone if no project selected
    onDragEnter: () => setIsDragActive(true),
    onDragLeave: () => setIsDragActive(false),
    onDropAccepted: () => setIsDragActive(false),
    onDropRejected: () => setIsDragActive(false)
  });

  const handleUpload = async (filesToUpload: FileWithPreview[], selectedProjectId: string, userId: string) => {
    if (!selectedProjectId || !userId || filesToUpload.length === 0) {
      return;
    }

    setIsUploading(true);
    
    let successCount = 0;
    let errorCount = 0;
    
    const totalFiles = filesToUpload.length;
    
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      
      try {
        setFiles(prev => 
          prev.map(f => 
            f === file ? { ...f, status: "uploading" as const } : f
          )
        );
        
        const uploadedImage = await uploadImage(file, selectedProjectId, userId, undefined, autoSegment);
        
        setFiles(prev => 
          prev.map(f => 
            f === file ? { 
              ...f, 
              status: "complete" as const,
              id: uploadedImage.id,
              uploadProgress: 100
            } : f
          )
        );
        
        successCount++;
      } catch (error) {
        console.error("Upload error:", error);
        
        setFiles(prev => 
          prev.map(f => 
            f === file ? { ...f, status: "error" as const } : f
          )
        );
        
        errorCount++;
      }
      
      const newProgress = Math.round(((i + 1) / totalFiles) * 100);
      setUploadProgress(newProgress);
    }
    
    setIsUploading(false);
    
    if (successCount > 0) {
      toast.success(`${t('images.imagesUploaded')}: ${successCount}`);
      
      if (errorCount === 0 && !currentProjectId) {
        setTimeout(() => {
          navigate(`/project/${selectedProjectId}`);
        }, 1000);
      } else if (currentProjectId) {
        // Refresh current project page to show new images
        window.location.reload();
      }
    }
    
    if (errorCount > 0) {
      toast.error(`${t('images.imagesFailed')}: ${errorCount}`);
    }
  };

  const removeFile = (file: FileWithPreview) => {
    URL.revokeObjectURL(file.preview || "");
    setFiles(files.filter(f => f !== file));
    
    const completedFiles = files.filter(f => f.status === "complete").length;
    const newProgress = files.length > 1 ? Math.round((completedFiles / (files.length - 1)) * 100) : 0;
    setUploadProgress(newProgress);
  };

  const handleProjectChange = (value: string) => {
    setProjectId(value);
  };

  useEffect(() => {
    return () => {
      files.forEach(file => URL.revokeObjectURL(file.preview || ""));
    };
  }, [files]);

  return (
    <div className="space-y-6">
      <UploaderOptions 
        showProjectSelector={!currentProjectId}
        projectId={projectId}
        autoSegment={autoSegment}
        onProjectChange={handleProjectChange}
        onAutoSegmentChange={setAutoSegment}
      />
      
      <DropZone 
        disabled={!projectId}
        onDrop={onDrop}
        isDragActive={isDragActive}
      />
      
      <FileList 
        files={files}
        uploadProgress={uploadProgress}
        onRemoveFile={removeFile}
      />
    </div>
  );
};

export default ImageUploader;
