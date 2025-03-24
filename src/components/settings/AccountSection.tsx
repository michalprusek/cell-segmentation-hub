
import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const AccountSection = () => {
  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Account settings saved successfully");
  };

  return (
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
  );
};

export default AccountSection;
