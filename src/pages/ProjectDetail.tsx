import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { segmentImage } from "@/lib/segmentation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import ImageUploader from "@/components/ImageUploader";
import ProjectHeader from "@/components/project/ProjectHeader";
import ProjectToolbar from "@/components/project/ProjectToolbar";
import ImageCard from "@/components/project/ImageCard";
import EmptyState from "@/components/project/EmptyState";
import ProjectImages from "@/components/project/ProjectImages";
import ProjectUploaderSection from "@/components/project/ProjectUploaderSection";
import type { Json } from "@/integrations/supabase/types";
import type { SegmentationResult } from "@/lib/segmentation";

interface ProjectImage {
  id: string;
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
  const { user } = useAuth();
  const { t } = useLanguage();
  
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [filteredImages, setFilteredImages] = useState<ProjectImage[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [loading, setLoading] = useState<boolean>(true);
  const [showUploader, setShowUploader] = useState<boolean>(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!id || !user) return;

      try {
        const { data: project, error: projectError } = await supabase
          .from("projects")
          .select("*")
          .eq("id", id)
          .single();

        if (projectError) {
          throw projectError;
        }

        if (!project) {
          toast.error("Project not found");
          navigate("/dashboard");
          return;
        }

        setProjectTitle(project.title);

        const { data: imagesData, error: imagesError } = await supabase
          .from("images")
          .select("*")
          .eq("project_id", id)
          .order("updated_at", { ascending: false });

        if (imagesError) {
          throw imagesError;
        }

        const formattedImages: ProjectImage[] = (imagesData || []).map(img => ({
          id: img.id,
          name: img.name,
          url: img.image_url || '/placeholder.svg',
          createdAt: new Date(img.created_at),
          updatedAt: new Date(img.updated_at),
          segmentationStatus: img.segmentation_status as 'pending' | 'processing' | 'completed' | 'failed',
          segmentationResult: img.segmentation_result as unknown as SegmentationResult
        }));

        setImages(formattedImages);
        setFilteredImages(formattedImages);
      } catch (error) {
        console.error("Error fetching project:", error);
        toast.error("Failed to load project data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [id, navigate, user]);

  useEffect(() => {
    let result = [...images];
    
    if (searchTerm) {
      result = result.filter(img => 
        img.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
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

  const handleDeleteImage = async (imageId: string) => {
    try {
      const { error } = await supabase
        .from("images")
        .delete()
        .eq("id", imageId);

      if (error) {
        throw error;
      }

      setImages(prev => prev.filter(img => img.id !== imageId));
      toast.success(t('common.success'), {
        description: t('common.delete') + " " + t('common.success')
      });
    } catch (error: any) {
      console.error("Error deleting image:", error);
      toast.error(t('common.error'), {
        description: t('common.delete') + " " + t('common.error') + ": " + error.message
      });
    }
  };

  const handleOpenSegmentationEditor = (image: ProjectImage) => {
    if (!id) return;
    
    navigate(`/segmentation/${id}/${image.id}`);
    
    // Only update status if pending or failed
    if (image.segmentationStatus === 'pending' || image.segmentationStatus === 'failed') {
      updateImageProcessingStatus(image.id);
    }
  };

  const updateImageProcessingStatus = async (imageId: string) => {
    try {
      // First update the status to processing
      const { error: updateError } = await supabase
        .from("images")
        .update({ 
          segmentation_status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq("id", imageId);

      if (updateError) {
        console.error("Error updating status:", updateError);
        return;
      }

      // Update the local state
      setImages(prev => 
        prev.map(img => 
          img.id === imageId 
            ? { ...img, segmentationStatus: 'processing' as const, updatedAt: new Date() } 
            : img
        )
      );
      
      // Simulate processing (in a real app, this would be a backend process)
      setTimeout(async () => {
        try {
          const image = images.find(img => img.id === imageId);
          if (!image) return;
          
          const result = await segmentImage(image.url);
          
          const { error: resultUpdateError } = await supabase
            .from("images")
            .update({
              segmentation_status: 'completed',
              segmentation_result: result as unknown as Json,
              updated_at: new Date().toISOString()
            })
            .eq("id", imageId);

          if (resultUpdateError) {
            throw resultUpdateError;
          }
        } catch (error) {
          console.error("Segmentation failed:", error);
          
          await supabase
            .from("images")
            .update({
              segmentation_status: 'failed',
              updated_at: new Date().toISOString()
            })
            .eq("id", imageId);
        }
      }, 2000);
    } catch (error) {
      console.error("Error updating image status:", error);
    }
  };

  const toggleUploader = () => {
    setShowUploader(!showUploader);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <ProjectHeader 
        projectTitle={projectTitle} 
        imagesCount={filteredImages.length}
        loading={loading}
      />
      
      <div className="container mx-auto px-4 py-8">
        {showUploader ? (
          <ProjectUploaderSection onCancel={toggleUploader} />
        ) : (
          <ProjectToolbar 
            searchTerm={searchTerm}
            onSearchChange={handleSearch}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onToggleUploader={toggleUploader}
          />
        )}
        
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          </div>
        ) : filteredImages.length === 0 && !showUploader ? (
          <EmptyState 
            hasSearchTerm={!!searchTerm}
            onUpload={toggleUploader}
          />
        ) : !showUploader && (
          <ProjectImages 
            images={filteredImages}
            onDelete={handleDeleteImage}
            onOpen={handleOpenSegmentationEditor}
          />
        )}
      </div>
    </div>
  );
};

export default ProjectDetail;
