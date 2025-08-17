import React from 'react';
import { useState, useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Project, getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';

interface ProjectSelectorProps {
  value: string | null;
  onChange: (value: string) => void;
}

const ProjectSelector = ({ value, onChange }: ProjectSelectorProps) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    const fetchProjects = async () => {
      if (!user) return;

      try {
        const response = await apiClient.getProjects();
        setProjects(response.projects || []);
      } catch (error: unknown) {
        logger.error('Error fetching projects:', error);
        const errorMessage =
          getErrorMessage(error) || t('projects.failedToLoadProjects');
        toast.error(t('projects.failedToLoadProjects') + ': ' + errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [user, t]);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{t('projects.selectProject')}</label>
      <Select
        value={value?.toString() || ''}
        onValueChange={onChange}
        disabled={loading}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t('projects.selectProject')} />
        </SelectTrigger>
        <SelectContent>
          {projects.map(project => (
            <SelectItem key={project.id} value={project.id.toString()}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default ProjectSelector;
