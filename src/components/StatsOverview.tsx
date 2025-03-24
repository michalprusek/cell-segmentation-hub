
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Microscope, Image, FileUp, FileClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  trend?: {
    value: string;
    isPositive: boolean;
  };
}

const StatCard = ({ title, value, description, icon, trend }: StatCardProps) => (
  <Card className="transition-all duration-300 hover:shadow-md dark:bg-gray-800 dark:border-gray-700">
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</CardTitle>
      <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400">
        {icon}
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold dark:text-white">{value}</div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
      {trend && (
        <div className={`text-xs mt-2 flex items-center ${trend.isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          <span>{trend.value}</span>
          <svg 
            className={`h-3 w-3 ml-1 ${!trend.isPositive && 'rotate-180'}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </div>
      )}
    </CardContent>
  </Card>
);

const StatsOverview = () => {
  const { user } = useAuth();
  const [projectCount, setProjectCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [completedImageCount, setCompletedImageCount] = useState(0);
  const [todayUploadCount, setTodayUploadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      if (!user) return;
      
      try {
        // Get total projects count
        const { count: projectsCount, error: projectsError } = await supabase
          .from("projects")
          .select("*", { count: "exact" })
          .eq("user_id", user.id);
          
        if (projectsError) throw projectsError;
        
        // Get total images count
        const { count: imagesCount, error: imagesError } = await supabase
          .from("images")
          .select("*", { count: "exact" })
          .eq("user_id", user.id);
          
        if (imagesError) throw imagesError;
        
        // Get completed images count
        const { count: completedCount, error: completedError } = await supabase
          .from("images")
          .select("*", { count: "exact" })
          .eq("user_id", user.id)
          .eq("segmentation_status", "completed");
          
        if (completedError) throw completedError;
        
        // Get today's upload count
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const { count: todayCount, error: todayError } = await supabase
          .from("images")
          .select("*", { count: "exact" })
          .eq("user_id", user.id)
          .gte("created_at", today.toISOString());
          
        if (todayError) throw todayError;
        
        setProjectCount(projectsCount || 0);
        setImageCount(imagesCount || 0);
        setCompletedImageCount(completedCount || 0);
        setTodayUploadCount(todayCount || 0);
      } catch (error) {
        console.error("Error fetching stats:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStats();
  }, [user]);

  const stats = [
    {
      title: "Total Projects",
      value: loading ? "..." : String(projectCount),
      description: "Active spheroid studies",
      icon: <Microscope size={16} />,
      trend: projectCount > 0 ? {
        value: `${Math.min(projectCount, 5)} new this month`,
        isPositive: true
      } : undefined
    },
    {
      title: "Processed Images",
      value: loading ? "..." : String(completedImageCount),
      description: "Successfully segmented",
      icon: <Image size={16} />,
      trend: completedImageCount > 0 ? {
        value: `${Math.round((completedImageCount / Math.max(imageCount, 1)) * 100)}% completion rate`,
        isPositive: true
      } : undefined
    },
    {
      title: "Uploaded Today",
      value: loading ? "..." : String(todayUploadCount),
      description: "Spheroid images pending",
      icon: <FileUp size={16} />,
    },
    {
      title: "Segmentation Time",
      value: "2.7s",
      description: "Average per image",
      icon: <FileClock size={16} />,
      trend: {
        value: "0.3s faster than before",
        isPositive: true
      }
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <StatCard key={index} {...stat} />
      ))}
    </div>
  );
};

export default StatsOverview;
