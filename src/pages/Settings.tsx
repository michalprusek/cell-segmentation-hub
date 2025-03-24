
import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import DashboardHeader from "@/components/DashboardHeader";

const Settings = () => {
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Profile settings saved successfully");
  };

  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Notification settings saved successfully");
  };

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Account settings saved successfully");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardHeader />
      
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">Settings</h1>
          <p className="text-gray-500">Manage your account preferences</p>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <Tabs defaultValue="profile" className="w-full">
            <div className="px-4 py-3 border-b border-gray-200">
              <TabsList className="grid w-full md:w-auto grid-cols-3 md:inline-flex h-9">
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
                <TabsTrigger value="account">Account</TabsTrigger>
              </TabsList>
            </div>
            
            <div className="p-6">
              <TabsContent value="profile" className="mt-0">
                <form onSubmit={handleSaveProfile}>
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Personal Information</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="fullName">Full Name</Label>
                          <Input id="fullName" defaultValue="Jane Doe" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="email">Email</Label>
                          <Input id="email" type="email" defaultValue="jane.doe@example.com" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="organization">Organization</Label>
                          <Input id="organization" defaultValue="Research Institute" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="department">Department</Label>
                          <Input id="department" defaultValue="Cell Biology" />
                        </div>
                      </div>
                    </div>
                    
                    <Separator />
                    
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Public Profile</h3>
                      <div className="space-y-2">
                        <Label htmlFor="bio">Bio</Label>
                        <Input id="bio" defaultValue="Researcher specializing in 3D cell cultures and spheroid analysis." />
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch id="publicProfile" defaultChecked />
                        <Label htmlFor="publicProfile" className="cursor-pointer">Make my profile visible to other researchers</Label>
                      </div>
                    </div>
                    
                    <div className="flex justify-end">
                      <Button type="submit">Save Changes</Button>
                    </div>
                  </div>
                </form>
              </TabsContent>
              
              <TabsContent value="notifications" className="mt-0">
                <form onSubmit={handleSaveNotifications}>
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Email Notifications</h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="emailUpdates">Project Updates</Label>
                            <p className="text-sm text-gray-500">Receive updates when changes are made to your projects</p>
                          </div>
                          <Switch id="emailUpdates" defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="emailResults">Segmentation Results</Label>
                            <p className="text-sm text-gray-500">Receive notifications when segmentation completes</p>
                          </div>
                          <Switch id="emailResults" defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="emailMarketing">Newsletter & Updates</Label>
                            <p className="text-sm text-gray-500">Receive product updates and new feature announcements</p>
                          </div>
                          <Switch id="emailMarketing" />
                        </div>
                      </div>
                    </div>
                    
                    <Separator />
                    
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">In-App Notifications</h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="appCollaborations">Collaboration Requests</Label>
                            <p className="text-sm text-gray-500">Notifications for new collaboration requests</p>
                          </div>
                          <Switch id="appCollaborations" defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="appComments">Comments & Mentions</Label>
                            <p className="text-sm text-gray-500">Notifications when you're mentioned in comments</p>
                          </div>
                          <Switch id="appComments" defaultChecked />
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex justify-end">
                      <Button type="submit">Save Preferences</Button>
                    </div>
                  </div>
                </form>
              </TabsContent>
              
              <TabsContent value="account" className="mt-0">
                <form onSubmit={handleSaveAccount}>
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Password</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="currentPassword">Current Password</Label>
                          <Input id="currentPassword" type="password" />
                        </div>
                        <div></div>
                        <div className="space-y-2">
                          <Label htmlFor="newPassword">New Password</Label>
                          <Input id="newPassword" type="password" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="confirmPassword">Confirm New Password</Label>
                          <Input id="confirmPassword" type="password" />
                        </div>
                      </div>
                    </div>
                    
                    <Separator />
                    
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium text-red-600">Danger Zone</h3>
                      <div className="p-4 border border-red-200 bg-red-50 rounded-md">
                        <h4 className="font-medium mb-2">Delete Account</h4>
                        <p className="text-sm text-gray-700 mb-4">Once you delete your account, there is no going back. All your data will be permanently deleted.</p>
                        <Button variant="destructive">Delete Account</Button>
                      </div>
                    </div>
                    
                    <div className="flex justify-end">
                      <Button type="submit">Save Changes</Button>
                    </div>
                  </div>
                </form>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Settings;
