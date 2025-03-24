
import React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const NotificationSection = () => {
  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Notification settings saved successfully");
  };

  return (
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
  );
};

export default NotificationSection;
