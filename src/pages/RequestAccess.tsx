
import React, { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const RequestAccess = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [institution, setInstitution] = useState("");
  const [purpose, setPurpose] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name || !email || !institution || !purpose) {
      toast.error("Please fill in all fields");
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Insert the access request
      const { error } = await supabase
        .from("access_requests")
        .insert([
          {
            name,
            email,
            institution,
            purpose
          }
        ]);
      
      if (error) throw error;
      
      toast.success("Access request submitted successfully", {
        description: "We'll review your request and get back to you soon."
      });
      
      // Clear form
      setName("");
      setEmail("");
      setInstitution("");
      setPurpose("");
      
    } catch (error: any) {
      console.error("Error submitting access request:", error);
      toast.error("Failed to submit request", {
        description: error.message
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 bg-gray-50 py-12 mt-16">
        <div className="container max-w-4xl mx-auto px-4">
          <Card className="shadow-md">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-3xl font-bold mb-2">Request Access</CardTitle>
              <CardDescription className="text-lg">
                Complete this form to request access to SpheroSeg for your research
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-base font-medium">Full Name</Label>
                      <Input 
                        id="name" 
                        placeholder="John Doe" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-12"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-base font-medium">Email Address</Label>
                      <Input 
                        id="email" 
                        type="email" 
                        placeholder="john.doe@university.edu" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-12"
                        required
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="institution" className="text-base font-medium">Institution/Organization</Label>
                    <Input 
                      id="institution" 
                      placeholder="University of Science" 
                      value={institution}
                      onChange={(e) => setInstitution(e.target.value)}
                      className="h-12"
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="purpose" className="text-base font-medium">
                      How do you plan to use SpheroSeg?
                    </Label>
                    <Textarea 
                      id="purpose" 
                      placeholder="Please describe your research and how SpheroSeg will help with your work..."
                      rows={5}
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      className="min-h-32"
                      required
                    />
                  </div>
                </div>
                
                <div className="flex justify-end space-x-4 pt-2">
                  <Button variant="outline" size="lg" asChild>
                    <Link to="/">
                      Return Home
                    </Link>
                  </Button>
                  <Button type="submit" size="lg" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      "Submit Request"
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
            <CardFooter className="text-sm text-gray-500 border-t pt-6 text-center">
              <p>
                By submitting this form, you agree to our{" "}
                <Link to="/terms-of-service" className="text-blue-600 hover:underline font-medium">
                  Terms of Service
                </Link>{" "}
                {" "}and{" "}
                <Link to="/privacy-policy" className="text-blue-600 hover:underline font-medium">
                  Privacy Policy
                </Link>
                .
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default RequestAccess;
