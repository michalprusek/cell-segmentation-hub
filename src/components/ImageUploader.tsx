
import React, { useCallback, useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Loader2, Upload, X, Image as ImageIcon, CheckCircle } from "lucide-react";
import ProjectSelector from "./ProjectSelector";
import { uploadImage } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { segmentImage } from "@/lib/segmentation";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const ImageUploader = () => {
  const [files, setFiles] = useState<(File & { preview?: string })[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadStatus, setUploadStatus] = useState<Record<string, 'pending' | 'uploading' | 'success' | 'error'>>({});
  const [autoSegment, setAutoSegment] = useState(false);
  const [totalProgress, setTotalProgress] = useState(0);
  const { user } = useAuth();
  const navigate = useNavigate();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (!selectedProject || !user) {
      toast.error("Please select a project first");
      return;
    }

    // Create preview URLs for the accepted files
    const filesWithPreview = acceptedFiles.map(file => 
      Object.assign(file, {
        preview: URL.createObjectURL(file)
      })
    );
    
    setFiles(prev => [...prev, ...filesWithPreview]);
    
    // Initialize upload status for each file
    const initialStatus: Record<string, 'pending' | 'uploading' | 'success' | 'error'> = {};
    acceptedFiles.forEach(file => {
      initialStatus[file.name] = 'uploading';
    });
    
    setUploadStatus(prev => ({...prev, ...initialStatus}));
    setUploadProgress(prev => {
      const newProgress = {...prev};
      acceptedFiles.forEach(file => {
        newProgress[file.name] = 0;
      });
      return newProgress;
    });

    // Start uploading immediately
    uploadFiles(filesWithPreview, selectedProject, user.id);
  }, [selectedProject, user]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.tif', '.tiff', '.bmp']
    },
    noClick: !selectedProject || !user
  });

  const removeFile = (name: string) => {
    setFiles(files.filter(file => file.name !== name));
    
    // Clean up upload status and progress
    const newStatus = {...uploadStatus};
    delete newStatus[name];
    setUploadStatus(newStatus);
    
    const newProgress = {...uploadProgress};
    delete newProgress[name];
    setUploadProgress(newProgress);
  };

  const uploadFiles = async (filesToUpload: (File & { preview?: string })[], projectId: string, userId: string) => {
    if (filesToUpload.length === 0) {
      toast.error("Please select at least one file");
      return;
    }
    
    if (!userId) {
      toast.error("You must be logged in to upload files");
      return;
    }
    
    setUploading(true);
    
    // Set status of all pending files to uploading
    const updatedStatus = {...uploadStatus};
    filesToUpload.forEach(file => {
      updatedStatus[file.name] = 'uploading';
    });
    setUploadStatus(updatedStatus);
    
    let uploadedCount = 0;
    const uploadedImages: { id: string; url: string }[] = [];
    
    for (const file of filesToUpload) {
      try {
        // Simulate progress updates
        const progressInterval = setInterval(() => {
          setUploadProgress(prev => {
            const newProgress = {...prev};
            // Don't go to 100% until actually complete
            if (newProgress[file.name] < 90) {
              newProgress[file.name] += Math.floor(Math.random() * 10) + 1;
            }
            return newProgress;
          });
          
          // Update total progress
          updateTotalProgress();
        }, 300);
        
        // Upload the file
        const uploadedImage = await uploadImage(file, projectId, userId);
        
        // Clear interval and set progress to 100%
        clearInterval(progressInterval);
        setUploadProgress(prev => ({...prev, [file.name]: 100}));
        setUploadStatus(prev => ({...prev, [file.name]: 'success'}));
        uploadedCount++;
        
        if (uploadedImage && uploadedImage.id) {
          uploadedImages.push({
            id: uploadedImage.id,
            url: uploadedImage.image_url
          });
        }
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        setUploadStatus(prev => ({...prev, [file.name]: 'error'}));
      }
    }
    
    // Set total progress to 100% when done
    setTotalProgress(100);
    
    if (uploadedCount > 0) {
      toast.success(`Successfully uploaded ${uploadedCount} ${uploadedCount === 1 ? 'file' : 'files'}`);
      
      // Check if auto-segmentation is enabled
      if (autoSegment && uploadedImages.length > 0) {
        for (const image of uploadedImages) {
          try {
            // Update status to processing
            await supabase
              .from("images")
              .update({ segmentation_status: 'processing' })
              .eq("id", image.id);
            
            // Start segmentation in background
            // In a real app, this would be a background process or queue
            segmentImage(image.url).then(async (result) => {
              await supabase
                .from("images")
                .update({
                  segmentation_status: 'completed',
                  segmentation_result: result as any,
                  updated_at: new Date().toISOString()
                })
                .eq("id", image.id);
            }).catch(async (error) => {
              console.error("Segmentation failed:", error);
              await supabase
                .from("images")
                .update({
                  segmentation_status: 'failed',
                  updated_at: new Date().toISOString()
                })
                .eq("id", image.id);
            });
          } catch (error) {
            console.error("Error starting segmentation:", error);
          }
        }
        
        toast.info("Started automatic segmentation of uploaded images");
      }
      
      // Navigate to project detail page after all uploads are complete
      setTimeout(() => {
        navigate(`/project/${projectId}`);
      }, 1000);
    } else {
      toast.error("Failed to upload files");
    }
    
    setUploading(false);
  };

  // Update the total progress based on individual file progress
  const updateTotalProgress = () => {
    const fileNames = Object.keys(uploadProgress);
    if (fileNames.length === 0) {
      setTotalProgress(0);
      return;
    }
    
    const totalProgressValue = fileNames.reduce((sum, fileName) => {
      return sum + uploadProgress[fileName];
    }, 0) / fileNames.length;
    
    setTotalProgress(Math.round(totalProgressValue));
  };

  // Clean up previews when component unmounts
  useEffect(() => {
    return () => {
      files.forEach(file => {
        if (file.preview) {
          URL.revokeObjectURL(file.preview);
        }
      });
    };
  }, [files]);

  const getUploadIcon = (status: 'pending' | 'uploading' | 'success' | 'error') => {
    switch (status) {
      case 'uploading':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <X className="h-4 w-4 text-red-500" />;
      default:
        return <Upload className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Upload Images</h3>
        <p className="text-sm text-gray-500">
          Select a project and upload spheroid images for segmentation
        </p>
      </div>
      
      <ProjectSelector 
        value={selectedProject} 
        onChange={setSelectedProject} 
      />

      <div className="flex items-center space-x-2">
        <Switch
          id="auto-segment"
          checked={autoSegment}
          onCheckedChange={setAutoSegment}
        />
        <Label htmlFor="auto-segment">
          Automatically start segmentation after upload
        </Label>
      </div>
      
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragActive ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"
        } ${!selectedProject || !user ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <input {...getInputProps()} />
        <div className="space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
            <ImageIcon className="h-6 w-6 text-blue-500" />
          </div>
          <h4 className="text-base font-medium">
            {!selectedProject 
              ? "Select a project first" 
              : "Drag and drop your images here"}
          </h4>
          <p className="text-sm text-gray-500">
            {selectedProject && user 
              ? <span>or <span className="text-blue-500 font-medium">browse files</span></span>
              : "Images will upload automatically after drop"}
          </p>
          <p className="text-xs text-gray-400">
            Supported formats: JPEG, PNG, TIFF, BMP
          </p>
        </div>
      </div>
      
      {totalProgress > 0 && totalProgress < 100 && (
        <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
          <div 
            className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
            style={{ width: `${totalProgress}%` }}
          ></div>
          <p className="text-xs text-gray-500 mt-1 text-right">
            {totalProgress}% uploaded
          </p>
        </div>
      )}
      
      {files.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Uploaded Files ({files.length})</Label>
          </div>
          
          <div className="space-y-3 max-h-80 overflow-y-auto p-1">
            {files.map((file) => (
              <div key={file.name} className="flex items-center p-2 border rounded-md bg-gray-50">
                <div className="h-12 w-12 rounded overflow-hidden bg-white flex-shrink-0 border">
                  {file.preview ? (
                    <img 
                      src={file.preview} 
                      alt={file.name} 
                      className="h-full w-full object-cover" 
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center bg-gray-100">
                      <ImageIcon className="h-6 w-6 text-gray-400" />
                    </div>
                  )}
                </div>
                <div className="ml-3 flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <div className="ml-4 flex-shrink-0 flex items-center space-x-2">
                  {uploadStatus[file.name] && (
                    <div className="flex items-center">
                      {getUploadIcon(uploadStatus[file.name])}
                      {uploadStatus[file.name] === 'uploading' && (
                        <span className="ml-1 text-xs">{uploadProgress[file.name]}%</span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file.name);
                    }}
                    className={`p-1 rounded-full hover:bg-gray-200 ${
                      uploadStatus[file.name] === 'uploading' ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    disabled={uploadStatus[file.name] === 'uploading'}
                  >
                    <X className="h-4 w-4 text-gray-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
