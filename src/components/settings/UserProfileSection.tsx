
import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { updateUserProfile } from "@/lib/supabase";

interface UserProfileSectionProps {
  userId: string;
  profile: any;
}

const UserProfileSection = ({ userId, profile }: UserProfileSectionProps) => {
  const [formData, setFormData] = useState({
    fullName: profile?.username || "",
    organization: profile?.organization || "",
    department: profile?.department || "",
    bio: profile?.bio || "",
    publicProfile: profile?.public_profile || false
  });
  const [loading, setLoading] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    setLoading(true);
    try {
      await updateUserProfile(userId, {
        username: formData.fullName,
        organization: formData.organization,
        department: formData.department,
        bio: formData.bio,
        public_profile: formData.publicProfile,
        updated_at: new Date()
      });
      
      toast.success("Profile settings saved successfully");
    } catch (error) {
      console.error("Error saving profile:", error);
      toast.error("Failed to save profile settings");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSaveProfile}>
      <div className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Personal Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input 
                id="fullName" 
                value={formData.fullName}
                onChange={(e) => setFormData({...formData, fullName: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                value={profile?.email || ""}
                readOnly 
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization">Organization</Label>
              <Input 
                id="organization" 
                value={formData.organization}
                onChange={(e) => setFormData({...formData, organization: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input 
                id="department" 
                value={formData.department}
                onChange={(e) => setFormData({...formData, department: e.target.value})}
              />
            </div>
          </div>
        </div>
        
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Public Profile</h3>
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Input 
              id="bio" 
              value={formData.bio}
              onChange={(e) => setFormData({...formData, bio: e.target.value})}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Switch 
              id="publicProfile" 
              checked={formData.publicProfile}
              onCheckedChange={(checked) => setFormData({...formData, publicProfile: checked})}
            />
            <Label htmlFor="publicProfile" className="cursor-pointer">Make my profile visible to other researchers</Label>
          </div>
        </div>
        
        <div className="flex justify-end">
          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default UserProfileSection;
