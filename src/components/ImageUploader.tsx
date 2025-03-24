
import React, { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Upload, ImagePlus, FileX, CheckCircle, X } from "lucide-react";
import { uploadImage } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import ProjectSelector from "@/components/ProjectSelector";

interface FileWithPreview extends File {
  preview?: string;
  uploadProgress?: number;
  status?: "pending" | "uploading" | "complete" | "error";
  id?: string;
}

const ImageUploader = () => {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [autoSegment, setAutoSegment] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (!projectId) {
      toast.error("Please select a project first");
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
    
    // Start uploads immediately
    if (projectId && user) {
      handleUpload(newFiles, projectId, user.id);
    }
  }, [projectId, user]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': [],
      'image/png': [],
      'image/tiff': [],
      'image/bmp': []
    },
    maxSize: 10485760, // 10MB
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
        // Update status to uploading
        setFiles(prev => 
          prev.map(f => 
            f === file ? { ...f, status: "uploading" as const } : f
          )
        );
        
        // Upload the file
        const uploadedImage = await uploadImage(file, selectedProjectId, userId);
        
        // Update status to complete and save the image ID
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
        
        // Update status to error
        setFiles(prev => 
          prev.map(f => 
            f === file ? { ...f, status: "error" as const } : f
          )
        );
        
        errorCount++;
      }
      
      // Update overall progress
      const newProgress = Math.round(((i + 1) / totalFiles) * 100);
      setUploadProgress(newProgress);
    }
    
    setIsUploading(false);
    
    // Show toast with results
    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} images successfully`);
      
      // Redirect to project detail page after all uploads complete
      if (errorCount === 0) {
        setTimeout(() => {
          navigate(`/project/${selectedProjectId}`);
        }, 1000);
      }
    }
    
    if (errorCount > 0) {
      toast.error(`Failed to upload ${errorCount} images`);
    }
  };

  const removeFile = (file: FileWithPreview) => {
    URL.revokeObjectURL(file.preview || "");
    setFiles(files.filter(f => f !== file));
    
    // Recalculate progress
    const completedFiles = files.filter(f => f.status === "complete").length;
    const newProgress = files.length > 1 ? Math.round((completedFiles / (files.length - 1)) * 100) : 0;
    setUploadProgress(newProgress);
  };

  const handleProjectChange = (value: string) => {
    setProjectId(value);
  };

  // Clean up previews
  useEffect(() => {
    return () => {
      files.forEach(file => URL.revokeObjectURL(file.preview || ""));
    };
  }, [files]);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <ProjectSelector value={projectId} onChange={handleProjectChange} />
        
        <div className="flex items-center space-x-2">
          <Switch 
            id="auto-segment" 
            checked={autoSegment}
            onCheckedChange={setAutoSegment}
          />
          <Label htmlFor="auto-segment">
            Auto-segment images after upload
          </Label>
        </div>
      </div>
      
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
          isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400"
        } ${!projectId ? "opacity-70 pointer-events-none" : ""}`}
      >
        <input {...getInputProps()} disabled={!projectId} />
        <div className="flex flex-col items-center space-y-3 text-center">
          <Upload className="h-12 w-12 text-gray-400" />
          <div>
            <p className="text-base font-medium">
              {isDragActive ? "Drop the images here..." : "Drag & drop images here"}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              or click to select files
            </p>
          </div>
          <p className="text-xs text-gray-400">
            Accepted formats: JPEG, PNG, TIFF, BMP (max 10MB)
          </p>
        </div>
      </div>
      
      {files.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Upload Progress</h3>
            <span className="text-sm text-gray-500">{uploadProgress}%</span>
          </div>
          
          <Progress value={uploadProgress} className="h-2" />
          
          <div className="space-y-4 mt-6">
            <h3 className="text-sm font-medium">Files ({files.length})</h3>
            
            <div className="space-y-2">
              {files.map((file, index) => (
                <Card key={index} className="p-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 flex-shrink-0 rounded overflow-hidden bg-gray-100">
                      {file.preview ? (
                        <img
                          src={file.preview}
                          alt={file.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ImagePlus className="w-full h-full p-2 text-gray-400" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                    
                    <div className="flex-shrink-0 flex items-center">
                      {file.status === "pending" && (
                        <span className="text-sm text-yellow-500">Pending</span>
                      )}
                      {file.status === "uploading" && (
                        <span className="text-sm text-blue-500">Uploading</span>
                      )}
                      {file.status === "complete" && (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      )}
                      {file.status === "error" && (
                        <FileX className="h-5 w-5 text-red-500" />
                      )}
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-2"
                        onClick={() => removeFile(file)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
