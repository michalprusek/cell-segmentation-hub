
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

const Profile = () => {
  const { user, profile } = useAuth();
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectCount, setProjectCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);

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

        setProjectCount(projectCount || 0);
        setImageCount(imageCount || 0);

        // Format joined date
        const joinedDate = user.created_at 
          ? new Date(user.created_at)
          : new Date();
        
        const month = joinedDate.toLocaleString('default', { month: 'long' });
        const year = joinedDate.getFullYear();

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
  }, [user, profile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
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
    <div className="min-h-screen bg-gray-50">
      <DashboardHeader />
      
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-start mb-8">
          <h1 className="text-2xl font-bold">My Profile</h1>
          <div className="flex space-x-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/settings">
                <Edit className="h-4 w-4 mr-2" />
                Edit Profile
              </Link>
            </Button>
          </div>
        </div>
        
        {profileData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Profile Sidebar */}
            <div className="space-y-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-24 h-24 rounded-full overflow-hidden mb-4 border-2 border-blue-100">
                      <img 
                        src={profileData.avatar} 
                        alt={profileData.name} 
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <h2 className="text-xl font-semibold">{profileData.name}</h2>
                    <p className="text-gray-500">{profileData.title}</p>
                    <p className="text-sm text-gray-400 mt-1">{profileData.organization}</p>
                    
                    <div className="mt-4 w-full grid grid-cols-3 gap-2 text-center">
                      <div className="border border-gray-100 rounded-md p-2">
                        <p className="text-lg font-semibold">{profileData.projects}</p>
                        <p className="text-xs text-gray-500">Projects</p>
                      </div>
                      <div className="border border-gray-100 rounded-md p-2">
                        <p className="text-lg font-semibold">{profileData.publications}</p>
                        <p className="text-xs text-gray-500">Papers</p>
                      </div>
                      <div className="border border-gray-100 rounded-md p-2">
                        <p className="text-lg font-semibold">{profileData.analyses}</p>
                        <p className="text-xs text-gray-500">Analyses</p>
                      </div>
                    </div>
                    
                    <Separator className="my-4" />
                    
                    <div className="w-full space-y-3">
                      <div className="flex items-center text-sm">
                        <Mail className="h-4 w-4 mr-2 text-gray-400" />
                        <span>{profileData.email}</span>
                      </div>
                      <div className="flex items-center text-sm">
                        <MapPin className="h-4 w-4 mr-2 text-gray-400" />
                        <span>{profileData.location}</span>
                      </div>
                      <div className="flex items-center text-sm">
                        <Clock className="h-4 w-4 mr-2 text-gray-400" />
                        <span>Joined {profileData.joined}</span>
                      </div>
                    </div>
                    
                    <Separator className="my-4" />
                    
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => toast.success("API key copied to clipboard!")}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Copy API Key
                    </Button>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-medium mb-3">Collaborators ({profileData.collaborators})</h3>
                  <div className="flex flex-wrap gap-2">
                    {[...Array(Math.min(6, profileData.collaborators))].map((_, i) => (
                      <div key={i} className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center">
                        <User className="h-5 w-5 text-gray-500" />
                      </div>
                    ))}
                    {profileData.collaborators > 6 && (
                      <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                        +{profileData.collaborators - 6}
                      </div>
                    )}
                  </div>
                  
                  <Separator className="my-4" />
                  
                  <h3 className="font-medium mb-3">Connected Accounts</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Github className="h-5 w-5 mr-2" />
                        <span className="text-sm">GitHub</span>
                      </div>
                      <Button variant="ghost" size="sm">Connect</Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <ExternalLink className="h-5 w-5 mr-2" />
                        <span className="text-sm">ORCID</span>
                      </div>
                      <Button variant="ghost" size="sm">Connect</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold mb-4">About</h2>
                  <p className="text-gray-700">{profileData.bio}</p>
                  
                  <Separator className="my-6" />
                  
                  <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
                  <div className="space-y-4">
                    {["Created a new project 'Neural Organoids'", 
                      "Completed segmentation of 12 images in 'HeLa Cell Spheroids'",
                      "Updated analysis parameters for 'Pancreatic Islets'",
                      "Shared 'MCF-7 Breast Cancer' project with 3 collaborators"].map((activity, i) => (
                      <div key={i} className="flex">
                        <div className="w-12 flex-shrink-0 flex flex-col items-center">
                          <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                          <div className="w-0.5 h-full bg-gray-200 mt-1"></div>
                        </div>
                        <div className="flex-1 -mt-0.5">
                          <p className="text-gray-700">{activity}</p>
                          <p className="text-xs text-gray-500 mt-1">{i === 0 ? 'Today' : i === 1 ? 'Yesterday' : `${i + 1} days ago`}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold mb-4">Statistics</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 mb-2">Total Images Processed</h3>
                      <div className="text-3xl font-bold">{imageCount}</div>
                      <p className="text-xs text-green-600 mt-1">+12% from last month</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 mb-2">Average Processing Time</h3>
                      <div className="text-3xl font-bold">3.2s</div>
                      <p className="text-xs text-green-600 mt-1">-8% from last month</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 mb-2">Storage Used</h3>
                      <div className="text-3xl font-bold">4.7 GB</div>
                      <p className="text-xs text-gray-500 mt-1">of 10 GB (47%)</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 mb-2">API Requests</h3>
                      <div className="text-3xl font-bold">8,294</div>
                      <p className="text-xs text-gray-500 mt-1">This month</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold">Recent Publications</h2>
                    <Button variant="ghost" size="sm">View All</Button>
                  </div>
                  <div className="space-y-4">
                    {[
                      "3D tumor spheroid models for in vitro therapeutic screening: a systematic approach to enhance the biological relevance of data obtained",
                      "Advanced imaging and visualization of spheroids: a review of methods and applications",
                      "Machine learning approaches for automated segmentation of cell spheroids in 3D culture"
                    ].map((title, i) => (
                      <div key={i} className="p-3 border border-gray-100 rounded-md hover:border-gray-300 transition duration-200">
                        <h3 className="font-medium text-blue-600">{title}</h3>
                        <p className="text-xs text-gray-500 mt-1">Journal of Cell Biology • {2023 - i}</p>
                      </div>
                    ))}
                  </div>
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
