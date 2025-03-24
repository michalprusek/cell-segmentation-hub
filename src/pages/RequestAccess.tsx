
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const RequestAccess = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    institution: "",
    purpose: "",
    agreeToTerms: false
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: checked }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!formData.agreeToTerms) {
      toast.error("You must agree to the Terms of Service and Privacy Policy");
      return;
    }
    
    setLoading(true);
    
    try {
      // Store access request in Supabase
      const { error } = await supabase
        .from('access_requests')
        .insert([
          {
            email: formData.email,
            name: formData.name,
            institution: formData.institution,
            purpose: formData.purpose
          }
        ]);
        
      if (error) throw error;
      
      toast.success("Access request submitted successfully", {
        description: "We'll review your request and get back to you soon."
      });
      
      // Redirect to home page after successful submission
      setTimeout(() => {
        navigate("/");
      }, 3000);
    } catch (error) {
      console.error("Error submitting access request:", error);
      toast.error("Failed to submit request", {
        description: "Please try again later or contact support."
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="container mx-auto px-4 py-12 flex-1">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Request Access to SpheroSeg</CardTitle>
              <CardDescription>
                Please fill out this form to request access to our spheroid segmentation platform.
              </CardDescription>
            </CardHeader>
            
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="Your work or academic email"
                    value={formData.email}
                    onChange={handleChange}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    placeholder="Your full name"
                    value={formData.name}
                    onChange={handleChange}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="institution">Institution/Organization</Label>
                  <Input
                    id="institution"
                    name="institution"
                    required
                    placeholder="University, Research Center, or Company"
                    value={formData.institution}
                    onChange={handleChange}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="purpose">How do you plan to use SpheroSeg?</Label>
                  <Textarea
                    id="purpose"
                    name="purpose"
                    required
                    placeholder="Please describe your research or application"
                    className="min-h-[120px]"
                    value={formData.purpose}
                    onChange={handleChange}
                  />
                </div>
                
                <div className="flex items-start space-x-2 pt-2">
                  <input
                    type="checkbox"
                    id="agreeToTerms"
                    name="agreeToTerms"
                    className="mt-1"
                    checked={formData.agreeToTerms}
                    onChange={handleCheckboxChange}
                    required
                  />
                  <Label htmlFor="agreeToTerms" className="font-normal text-sm">
                    I agree to the <Link to="/terms-of-service" className="text-blue-500 hover:underline">Terms of Service</Link> and{" "}
                    <Link to="/privacy-policy" className="text-blue-500 hover:underline">Privacy Policy</Link>
                  </Label>
                </div>
              </CardContent>
              
              <CardFooter className="flex justify-between">
                <Button variant="outline" asChild>
                  <Link to="/">Back to Home</Link>
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Submitting..." : "Submit Request"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default RequestAccess;
