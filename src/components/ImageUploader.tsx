
import React, { useCallback, useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Upload, X, Image as ImageIcon, CheckCircle } from "lucide-react";
import ProjectSelector from "./ProjectSelector";
import { uploadImage } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

const ImageUploader = () => {
  const [files, setFiles] = useState<(File & { preview?: string })[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadStatus, setUploadStatus] = useState<Record<string, 'pending' | 'uploading' | 'success' | 'error'>>({});
  const { user } = useAuth();

  const onDrop = useCallback((acceptedFiles: File[]) => {
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
      initialStatus[file.name] = 'pending';
    });
    
    setUploadStatus(prev => ({...prev, ...initialStatus}));
    setUploadProgress(prev => {
      const newProgress = {...prev};
      acceptedFiles.forEach(file => {
        newProgress[file.name] = 0;
      });
      return newProgress;
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.tif', '.tiff', '.bmp']
    }
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

  const handleUpload = async () => {
    if (!selectedProject) {
      toast.error("Please select a project");
      return;
    }
    
    if (files.length === 0) {
      toast.error("Please select at least one file");
      return;
    }
    
    if (!user) {
      toast.error("You must be logged in to upload files");
      return;
    }
    
    setUploading(true);
    
    // Set status of all pending files to uploading
    const updatedStatus = {...uploadStatus};
    Object.keys(updatedStatus).forEach(fileName => {
      if (updatedStatus[fileName] === 'pending') {
        updatedStatus[fileName] = 'uploading';
      }
    });
    setUploadStatus(updatedStatus);
    
    const promises = files
      .filter(file => uploadStatus[file.name] === 'uploading')
      .map(async (file) => {
        try {
          // Simulate progress updates
          const interval = setInterval(() => {
            setUploadProgress(prev => {
              const newProgress = {...prev};
              // Don't go to 100% until actually complete
              if (newProgress[file.name] < 90) {
                newProgress[file.name] += Math.floor(Math.random() * 10) + 1;
              }
              return newProgress;
            });
          }, 300);
          
          // Upload the file
          await uploadImage(file, selectedProject, user.id);
          
          // Clear interval and set progress to 100%
          clearInterval(interval);
          setUploadProgress(prev => ({...prev, [file.name]: 100}));
          setUploadStatus(prev => ({...prev, [file.name]: 'success'}));
          return { name: file.name, success: true };
        } catch (error) {
          console.error(`Error uploading ${file.name}:`, error);
          setUploadStatus(prev => ({...prev, [file.name]: 'error'}));
          return { name: file.name, success: false, error };
        }
      });
    
    try {
      const results = await Promise.all(promises);
      const successCount = results.filter(r => r.success).length;
      
      if (successCount === results.length) {
        toast.success(`Successfully uploaded ${successCount} ${successCount === 1 ? 'file' : 'files'}`);
      } else if (successCount > 0) {
        toast.success(`Uploaded ${successCount} of ${results.length} files`);
      } else {
        toast.error("Failed to upload files");
      }
    } catch (error) {
      console.error("Error during upload:", error);
      toast.error("An error occurred during upload");
    } finally {
      setUploading(false);
    }
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
      
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragActive ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"
        }`}
      >
        <input {...getInputProps()} />
        <div className="space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
            <ImageIcon className="h-6 w-6 text-blue-500" />
          </div>
          <h4 className="text-base font-medium">Drag and drop your images here</h4>
          <p className="text-sm text-gray-500">
            or <span className="text-blue-500 font-medium">browse files</span>
          </p>
          <p className="text-xs text-gray-400">
            Supported formats: JPEG, PNG, TIFF, BMP
          </p>
        </div>
      </div>
      
      {files.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Selected Files ({files.length})</Label>
            <Button 
              onClick={handleUpload} 
              disabled={uploading || !selectedProject}
              size="sm"
            >
              {uploading ? "Uploading..." : "Upload All"}
            </Button>
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
