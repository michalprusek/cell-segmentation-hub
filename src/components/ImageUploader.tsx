
import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Cloud, X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

interface FileWithPreview extends File {
  preview: string;
  id: string;
  status: 'uploading' | 'success' | 'error';
  progress: number;
}

const ImageUploader = () => {
  const [files, setFiles] = useState<FileWithPreview[]>([]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles?.length) {
      const newFiles = acceptedFiles.map(file => 
        Object.assign(file, {
          preview: URL.createObjectURL(file),
          id: `${file.name}-${Date.now()}`,
          status: 'uploading' as const,
          progress: 0
        })
      );
      
      setFiles(prevFiles => [...prevFiles, ...newFiles]);
      
      // Simulate upload progress
      newFiles.forEach(file => {
        simulateUpload(file.id);
      });
      
      toast.success(`${acceptedFiles.length} images added for upload`, {
        description: "Processing will begin automatically"
      });
    }
  }, []);
  
  const simulateUpload = (fileId: string) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 10) + 5;
      
      if (progress >= 100) {
        clearInterval(interval);
        progress = 100;
        
        setFiles(prevFiles => 
          prevFiles.map(file => 
            file.id === fileId 
              ? { ...file, status: 'success', progress: 100 } 
              : file
          )
        );
        
        // Success toast
        toast.success("Image uploaded successfully", {
          description: "Ready for segmentation analysis"
        });
      } else {
        setFiles(prevFiles => 
          prevFiles.map(file => 
            file.id === fileId ? { ...file, progress } : file
          )
        );
      }
    }, 300);
  };
  
  const removeFile = (fileId: string) => {
    setFiles(prevFiles => {
      const filteredFiles = prevFiles.filter(file => file.id !== fileId);
      return filteredFiles;
    });
  };
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.tif', '.tiff']
    },
    maxSize: 20971520, // 20MB
  });
  
  return (
    <div className="space-y-6">
      <div
        {...getRootProps()}
        className={`border-2 ${
          isDragActive ? "border-blue-400 bg-blue-50" : "border-dashed border-gray-300"
        } rounded-xl p-8 transition-all duration-200 ease-in-out cursor-pointer hover:bg-gray-50`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <div className="p-3 rounded-full bg-blue-50 text-blue-500">
            <Cloud size={24} />
          </div>
          <div>
            <p className="font-medium">
              {isDragActive ? "Drop the files here" : "Drag & drop image files here"}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              or click to browse from your computer
            </p>
          </div>
          <p className="text-xs text-gray-400">
            Supports: JPEG, PNG, TIFF (up to 20MB)
          </p>
        </div>
      </div>
      
      {files && files.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Uploaded Images</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {files.map((file) => (
              <Card key={file.id} className="overflow-hidden">
                <div className="aspect-video relative overflow-hidden bg-gray-100">
                  <img
                    src={file.preview}
                    alt={file.name}
                    className="h-full w-full object-cover"
                    onLoad={() => {
                      URL.revokeObjectURL(file.preview);
                    }}
                  />
                  <button
                    type="button"
                    className="absolute top-2 right-2 rounded-full bg-white/80 p-1 text-gray-600 shadow-sm hover:bg-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file.id);
                    }}
                  >
                    <X size={16} />
                  </button>
                  {file.status !== 'success' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      {file.status === 'uploading' ? (
                        <Loader2 className="h-8 w-8 text-white animate-spin" />
                      ) : (
                        <AlertCircle className="h-8 w-8 text-red-500" />
                      )}
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium truncate" title={file.name}>
                      {file.name.length > 25
                        ? `${file.name.substring(0, 25)}...`
                        : file.name}
                    </p>
                    {file.status === 'success' ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : file.status === 'error' ? (
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    ) : null}
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                  <Progress value={file.progress} className="h-1.5" />
                </CardContent>
              </Card>
            ))}
          </div>
          
          {files.some(file => file.status === 'uploading') ? (
            <Button disabled className="w-full">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </Button>
          ) : (
            <Button className="w-full">Process All Images</Button>
          )}
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
