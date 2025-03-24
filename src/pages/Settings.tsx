
import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import DashboardHeader from "@/components/DashboardHeader";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import UserProfileSection from "@/components/settings/UserProfileSection";
import NotificationSection from "@/components/settings/NotificationSection";
import AccountSection from "@/components/settings/AccountSection";

const Settings = () => {
  const { user, profile, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <Skeleton className="h-8 w-32 mb-1" />
            <Skeleton className="h-4 w-64" />
          </div>
          
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <Skeleton className="h-8 w-64" />
            </div>
            
            <div className="p-6">
              <div className="space-y-6">
                <div className="space-y-4">
                  <Skeleton className="h-6 w-48" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                </div>
                
                <Separator />
                
                <div className="space-y-4">
                  <Skeleton className="h-6 w-36" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-12 w-72" />
                </div>
                
                <div className="flex justify-end">
                  <Skeleton className="h-10 w-32" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
                {user && <UserProfileSection userId={user.id} profile={profile} />}
              </TabsContent>
              
              <TabsContent value="notifications" className="mt-0">
                <NotificationSection />
              </TabsContent>
              
              <TabsContent value="account" className="mt-0">
                <AccountSection />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Settings;
