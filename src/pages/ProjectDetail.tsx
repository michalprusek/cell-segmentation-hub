
import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  Search, 
  ArrowUp, 
  ArrowDown, 
  Clock, 
  Image as ImageIcon, 
  X, 
  CheckCircle, 
  Clock3, 
  AlertCircle, 
  Loader2,
  ArrowUpDown
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { segmentImage, SegmentationResult } from "@/lib/segmentation";

interface ProjectImage {
  id: number;
  name: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  segmentationResult?: SegmentationResult;
}

type SortField = 'name' | 'updatedAt' | 'segmentationStatus';
type SortDirection = 'asc' | 'desc';

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [filteredImages, setFilteredImages] = useState<ProjectImage[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch project data and images
  useEffect(() => {
    const fetchData = async () => {
      try {
        // In a real app, this would fetch from Supabase
        // For demonstration, we'll use sample data
        const projects = [
          { id: 1, title: "HeLa Cell Spheroids" },
          { id: 2, title: "MCF-7 Breast Cancer" },
          { id: 3, title: "Neural Organoids" },
          { id: 4, title: "Pancreatic Islets" },
          { id: 5, title: "Liver Microtissues" },
          { id: 6, title: "Embryoid Bodies" },
        ];
        
        const project = projects.find(p => p.id.toString() === id);
        
        if (project) {
          setProjectTitle(project.title);
          
          // Generate sample images
          const sampleImages: ProjectImage[] = Array(12).fill(null).map((_, index) => ({
            id: index + 1,
            name: `${project.title.split(' ')[0]}_Image_${index + 1}.png`,
            url: `/placeholder.svg`, // In a real app, this would be the actual image URL
            createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
            segmentationStatus: ['pending', 'processing', 'completed', 'failed'][Math.floor(Math.random() * 4)] as any
          }));
          
          setImages(sampleImages);
          setFilteredImages(sampleImages);
        } else {
          toast.error("Project not found");
          navigate("/dashboard");
        }
      } catch (error) {
        console.error("Error fetching project:", error);
        toast.error("Failed to load project data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [id, navigate]);

  // Filter and sort images
  useEffect(() => {
    let result = [...images];
    
    // Apply search filter
    if (searchTerm) {
      result = result.filter(img => 
        img.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'updatedAt':
          comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
          break;
        case 'segmentationStatus':
          const statusOrder = { completed: 1, processing: 2, pending: 3, failed: 4 };
          comparison = statusOrder[a.segmentationStatus] - statusOrder[b.segmentationStatus];
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    setFilteredImages(result);
  }, [images, searchTerm, sortField, sortDirection]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleDeleteImage = (imageId: number) => {
    setImages(prev => prev.filter(img => img.id !== imageId));
    toast.success("Image deleted successfully");
  };

  const handleOpenSegmentationEditor = (image: ProjectImage) => {
    if (image.segmentationStatus === 'pending' || image.segmentationStatus === 'failed') {
      // Start segmentation process
      toast.info("Starting segmentation process...");
      
      // Update image status to processing
      setImages(prev => 
        prev.map(img => 
          img.id === image.id 
            ? { ...img, segmentationStatus: 'processing' as const } 
            : img
        )
      );
      
      // Simulate segmentation process
      setTimeout(async () => {
        try {
          const result = await segmentImage(image.url);
          
          // Update image with segmentation result
          setImages(prev => 
            prev.map(img => 
              img.id === image.id 
                ? { 
                    ...img, 
                    segmentationStatus: 'completed' as const,
                    segmentationResult: result,
                    updatedAt: new Date()
                  } 
                : img
            )
          );
          
          // Navigate to editor
          navigate(`/segmentation/${id}/${image.id}`);
        } catch (error) {
          console.error("Segmentation failed:", error);
          
          // Update image status to failed
          setImages(prev => 
            prev.map(img => 
              img.id === image.id 
                ? { 
                    ...img, 
                    segmentationStatus: 'failed' as const,
                    updatedAt: new Date()
                  } 
                : img
            )
          );
          
          toast.error("Segmentation failed", {
            description: "Please try again later"
          });
        }
      }, 2000);
    } else {
      // Navigate directly to editor
      navigate(`/segmentation/${id}/${image.id}`);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <Clock3 className="h-4 w-4 text-yellow-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center">
            <Button 
              variant="outline" 
              size="sm" 
              className="mr-4"
              onClick={() => navigate("/dashboard")}
            >
              Back
            </Button>
            <div>
              <h1 className="text-xl font-semibold">{projectTitle}</h1>
              <p className="text-sm text-gray-500">
                {loading ? "Loading..." : `${filteredImages.length} images`}
              </p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 space-y-4 md:space-y-0">
          <div className="relative w-full md:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              className="pl-10 pr-4 w-full md:w-80"
              placeholder="Search images by name..."
              value={searchTerm}
              onChange={handleSearch}
            />
          </div>
          
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSort('name')}
              className="flex items-center"
            >
              Name
              {sortField === 'name' && (
                sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
              )}
              {sortField !== 'name' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSort('updatedAt')}
              className="flex items-center"
            >
              Last Change
              {sortField === 'updatedAt' && (
                sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
              )}
              {sortField !== 'updatedAt' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSort('segmentationStatus')}
              className="flex items-center"
            >
              Status
              {sortField === 'segmentationStatus' && (
                sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
              )}
              {sortField !== 'segmentationStatus' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
            </Button>
          </div>
        </div>
        
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          </div>
        ) : filteredImages.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <ImageIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium mb-2">No images found</h3>
            <p className="text-gray-500 mb-6">
              {searchTerm ? "Try a different search term" : "Upload some images to get started"}
            </p>
            <Button
              onClick={() => navigate(`/dashboard`)}
            >
              Upload Images
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredImages.map((image) => (
              <Card 
                key={image.id} 
                className="overflow-hidden cursor-pointer group hover:ring-2 hover:ring-blue-200 transition-all duration-200"
                onClick={() => handleOpenSegmentationEditor(image)}
              >
                <div className="aspect-square relative">
                  <img 
                    src={image.url} 
                    alt={image.name} 
                    className="h-full w-full object-cover"
                  />
                  
                  {/* Status badge */}
                  <div className="absolute top-2 left-2 flex items-center space-x-1 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full text-xs">
                    {getStatusIcon(image.segmentationStatus)}
                    <span className="capitalize">{image.segmentationStatus}</span>
                  </div>
                  
                  {/* Delete button */}
                  <button
                    className="absolute top-2 right-2 bg-white/90 p-1 rounded-full text-gray-700 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteImage(image.id);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                  
                  {/* Image details overlay */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-white">
                    <h3 className="text-sm font-medium truncate">{image.name}</h3>
                    <div className="flex items-center text-xs text-white/80 mt-1">
                      <Clock className="h-3 w-3 mr-1" />
                      <span>{formatDistanceToNow(image.updatedAt, { addSuffix: true })}</span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectDetail;
