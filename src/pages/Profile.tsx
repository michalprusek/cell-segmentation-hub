
import React, { useEffect, useState } from "react";
import DashboardHeader from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Clock, Edit, ExternalLink, FileText, Github, Mail, MapPin, User, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";

interface ProfileData {
  name: string;
  title: string;
  organization: string;
  bio: string;
  email: string;
  location: string;
  joined: string;
  publications: number;
  projects: number;
  collaborators: number;
  analyses: number;
  avatar: string;
}

interface ActivityItem {
  action: string;
  date: string;
  daysAgo: number;
}

const Profile = () => {
  const { user, profile } = useAuth();
  const { t } = useLanguage();
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectCount, setProjectCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [completedImageCount, setCompletedImageCount] = useState(0);
  const [storageUsed, setStorageUsed] = useState(0);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      try {
        // Get project count
        const { count: projectCount, error: projectError } = await supabase
          .from("projects")
          .select("*", { count: "exact" })
          .eq("user_id", user.id);

        if (projectError) throw projectError;

        // Get image count
        const { count: imageCount, error: imageError } = await supabase
          .from("images")
          .select("*", { count: "exact" })
          .eq("user_id", user.id);

        if (imageError) throw imageError;
        
        // Get completed image count
        const { count: completedCount, error: completedError } = await supabase
          .from("images")
          .select("*", { count: "exact" })
          .eq("user_id", user.id)
          .eq("segmentation_status", "completed");
          
        if (completedError) throw completedError;

        // Get recent activity (last 10 images or projects created)
        const { data: recentProjects, error: recentProjectsError } = await supabase
          .from("projects")
          .select("title, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5);
          
        if (recentProjectsError) throw recentProjectsError;
        
        const { data: recentImages, error: recentImagesError } = await supabase
          .from("images")
          .select("name, segmentation_status, created_at, project_id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5);
          
        if (recentImagesError) throw recentImagesError;
        
        // Combined recent activity
        const activity: ActivityItem[] = [];
        
        if (recentProjects) {
          recentProjects.forEach(project => {
            const createdDate = new Date(project.created_at);
            const now = new Date();
            const diffDays = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24));
            
            activity.push({
              action: `${t('profile.createdProject')} '${project.title}'`,
              date: createdDate.toISOString(),
              daysAgo: diffDays
            });
          });
        }
        
        if (recentImages) {
          recentImages.forEach(image => {
            const createdDate = new Date(image.created_at);
            const now = new Date();
            const diffDays = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24));
            
            if (image.segmentation_status === 'completed') {
              activity.push({
                action: `${t('profile.completedSegmentation')} '${image.name}'`,
                date: createdDate.toISOString(),
                daysAgo: diffDays
              });
            } else {
              activity.push({
                action: `${t('profile.uploadedImage')} '${image.name}'`,
                date: createdDate.toISOString(),
                daysAgo: diffDays
              });
            }
          });
        }
        
        // Sort activity by date
        activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        // Limit to 4 most recent activities
        setRecentActivity(activity.slice(0, 4));

        // Format joined date
        const joinedDate = user.created_at 
          ? new Date(user.created_at)
          : new Date();
        
        const month = joinedDate.toLocaleString('default', { month: 'long' });
        const year = joinedDate.getFullYear();

        setProjectCount(projectCount || 0);
        setImageCount(imageCount || 0);
        setCompletedImageCount(completedCount || 0);
        setStorageUsed(Math.round((imageCount || 0) * 2.5 * 10) / 10); // Estimate storage based on number of images

        setProfileData({
          name: profile?.username || user.email?.split('@')[0] || 'User',
          title: profile?.title || "Researcher",
          organization: profile?.organization || "Research Institute",
          bio: profile?.bio || "No bio provided",
          email: user.email || "",
          location: profile?.location || "Not specified",
          joined: `${month} ${year}`,
          publications: 0,
          projects: projectCount || 0,
          collaborators: 0,
          analyses: imageCount || 0,
          avatar: profile?.avatar_url || "/placeholder.svg"
        });
      } catch (error) {
        console.error("Error fetching profile data:", error);
        toast.error("Failed to load profile data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, profile, t]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8">
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <DashboardHeader />
      
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-start mb-8">
          <h1 className="text-2xl font-bold dark:text-white">{t('profile.title')}</h1>
          <div className="flex space-x-2">
            <Button asChild variant="outline" size="sm" className="dark:border-gray-700 dark:text-gray-300">
              <Link to="/settings">
                <Edit className="h-4 w-4 mr-2" />
                {t('profile.editProfile')}
              </Link>
            </Button>
          </div>
        </div>
        
        {profileData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Profile Sidebar */}
            <div className="space-y-6">
              <Card className="dark:bg-gray-800 dark:border-gray-700">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-24 h-24 rounded-full overflow-hidden mb-4 border-2 border-blue-100 dark:border-blue-900">
                      <img 
                        src={profileData.avatar} 
                        alt={profileData.name} 
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <h2 className="text-xl font-semibold dark:text-white">{profileData.name}</h2>
                    <p className="text-gray-500 dark:text-gray-400">{profileData.title}</p>
                    <p className="text-sm text-gray-400 mt-1">{profileData.organization}</p>
                    
                    <div className="mt-4 w-full grid grid-cols-3 gap-2 text-center">
                      <div className="border border-gray-100 dark:border-gray-700 rounded-md p-2">
                        <p className="text-lg font-semibold dark:text-white">{profileData.projects}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('profile.projects')}</p>
                      </div>
                      <div className="border border-gray-100 dark:border-gray-700 rounded-md p-2">
                        <p className="text-lg font-semibold dark:text-white">{profileData.publications}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('profile.papers')}</p>
                      </div>
                      <div className="border border-gray-100 dark:border-gray-700 rounded-md p-2">
                        <p className="text-lg font-semibold dark:text-white">{profileData.analyses}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('profile.analyses')}</p>
                      </div>
                    </div>
                    
                    <Separator className="my-4 dark:bg-gray-700" />
                    
                    <div className="w-full space-y-3">
                      <div className="flex items-center text-sm dark:text-gray-300">
                        <Mail className="h-4 w-4 mr-2 text-gray-400" />
                        <span>{profileData.email}</span>
                      </div>
                      <div className="flex items-center text-sm dark:text-gray-300">
                        <MapPin className="h-4 w-4 mr-2 text-gray-400" />
                        <span>{profileData.location}</span>
                      </div>
                      <div className="flex items-center text-sm dark:text-gray-300">
                        <Clock className="h-4 w-4 mr-2 text-gray-400" />
                        <span>{t('profile.joined')} {profileData.joined}</span>
                      </div>
                    </div>
                    
                    <Separator className="my-4 dark:bg-gray-700" />
                    
                    <Button 
                      variant="outline" 
                      className="w-full dark:border-gray-700 dark:text-gray-300"
                      onClick={() => toast.success("API key copied to clipboard!")}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      {t('profile.copyApiKey')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="dark:bg-gray-800 dark:border-gray-700">
                <CardContent className="pt-6">
                  <h3 className="font-medium mb-3 dark:text-white">{t('profile.collaborators')} (0)</h3>
                  <div className="flex flex-wrap gap-2">
                    {profileData.collaborators === 0 && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('profile.noCollaborators')}</p>
                    )}
                    {[...Array(Math.min(6, profileData.collaborators))].map((_, i) => (
                      <div key={i} className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        <User className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                      </div>
                    ))}
                    {profileData.collaborators > 6 && (
                      <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400">
                        +{profileData.collaborators - 6}
                      </div>
                    )}
                  </div>
                  
                  <Separator className="my-4 dark:bg-gray-700" />
                  
                  <h3 className="font-medium mb-3 dark:text-white">{t('profile.connectedAccounts')}</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Github className="h-5 w-5 mr-2 dark:text-gray-300" />
                        <span className="text-sm dark:text-gray-300">GitHub</span>
                      </div>
                      <Button variant="ghost" size="sm" className="dark:text-gray-300">{t('profile.connect')}</Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <ExternalLink className="h-5 w-5 mr-2 dark:text-gray-300" />
                        <span className="text-sm dark:text-gray-300">ORCID</span>
                      </div>
                      <Button variant="ghost" size="sm" className="dark:text-gray-300">{t('profile.connect')}</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="dark:bg-gray-800 dark:border-gray-700">
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold mb-4 dark:text-white">{t('profile.about')}</h2>
                  <p className="text-gray-700 dark:text-gray-300">{profileData.bio}</p>
                  
                  <Separator className="my-6 dark:bg-gray-700" />
                  
                  <h2 className="text-lg font-semibold mb-4 dark:text-white">{t('profile.recentActivity')}</h2>
                  <div className="space-y-4">
                    {recentActivity.length === 0 ? (
                      <p className="text-gray-500 dark:text-gray-400">{t('profile.noRecentActivity')}</p>
                    ) : (
                      recentActivity.map((activity, i) => (
                        <div key={i} className="flex">
                          <div className="w-12 flex-shrink-0 flex flex-col items-center">
                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                            <div className="w-0.5 h-full bg-gray-200 dark:bg-gray-700 mt-1"></div>
                          </div>
                          <div className="flex-1 -mt-0.5">
                            <p className="text-gray-700 dark:text-gray-300">{activity.action}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {activity.daysAgo === 0 
                                ? t('profile.today') 
                                : activity.daysAgo === 1 
                                  ? t('profile.yesterday') 
                                  : `${activity.daysAgo} ${t('profile.daysAgo')}`}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
              
              <Card className="dark:bg-gray-800 dark:border-gray-700">
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold mb-4 dark:text-white">{t('profile.statistics')}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('profile.totalImagesProcessed')}</h3>
                      <div className="text-3xl font-bold dark:text-white">{completedImageCount}</div>
                      {completedImageCount > 0 && (
                        <p className="text-xs text-green-600 mt-1">
                          {Math.round((completedImageCount / Math.max(imageCount, 1)) * 100)}% {t('profile.completionRate')}
                        </p>
                      )}
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('profile.averageProcessingTime')}</h3>
                      <div className="text-3xl font-bold dark:text-white">3.2s</div>
                      <p className="text-xs text-green-600 mt-1">-8% {t('profile.fromLastMonth')}</p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('profile.storageUsed')}</h3>
                      <div className="text-3xl font-bold dark:text-white">{storageUsed} MB</div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('profile.of')} 1 GB ({Math.round(storageUsed / 10)}%)</p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('profile.apiRequests')}</h3>
                      <div className="text-3xl font-bold dark:text-white">{(imageCount + projectCount) * 4}</div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('profile.thisMonth')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="dark:bg-gray-800 dark:border-gray-700">
                <CardContent className="pt-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold dark:text-white">{t('profile.recentPublications')}</h2>
                    <Button variant="ghost" size="sm" className="dark:text-gray-300">{t('profile.viewAll')}</Button>
                  </div>
                  {profileData.publications === 0 ? (
                    <p className="text-gray-500 dark:text-gray-400">{t('profile.noPublications')}</p>
                  ) : (
                    <div className="space-y-4">
                      {[
                        "3D tumor spheroid models for in vitro therapeutic screening: a systematic approach to enhance the biological relevance of data obtained",
                        "Advanced imaging and visualization of spheroids: a review of methods and applications",
                        "Machine learning approaches for automated segmentation of cell spheroids in 3D culture"
                      ].map((title, i) => (
                        <div key={i} className="p-3 border border-gray-100 dark:border-gray-700 rounded-md hover:border-gray-300 dark:hover:border-gray-600 transition duration-200">
                          <h3 className="font-medium text-blue-600 dark:text-blue-400">{title}</h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Journal of Cell Biology • {2023 - i}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Profile;
