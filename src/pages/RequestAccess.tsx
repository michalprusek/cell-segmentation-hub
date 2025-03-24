import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent, 
  CardFooter 
} from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";

const RequestAccess = () => {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { t } = useLanguage();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !name || !institution || !reason) {
      toast.error("Please fill in all fields");
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const { error } = await supabase
        .from("access_requests")
        .insert({
          email,
          name,
          institution,
          purpose: reason,
          status: "pending"
        });
        
      if (error) throw error;
      
      setSubmitted(true);
      toast.success(t('requestAccess.requestReceived'));
    } catch (error: any) {
      console.error("Error submitting access request:", error);
      toast.error(`Failed to submit request: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <div className="py-6 px-8 bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
        <div className="container mx-auto">
          <Link to="/" className="text-xl font-bold dark:text-white">
            {t('common.appName')}
          </Link>
        </div>
      </div>
      
      <div className="flex-1 container max-w-screen-sm mx-auto px-4 py-8">
        <Card className="w-full">
          <CardHeader className="text-center space-y-1">
            <CardTitle className="text-2xl font-bold dark:text-white">
              {t('requestAccess.title')}
            </CardTitle>
            <CardDescription className="text-gray-500 dark:text-gray-400">
              {t('requestAccess.description')}
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {submitted ? (
              <div className="text-center py-8 space-y-4">
                <svg 
                  className="mx-auto h-16 w-16 text-green-500" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" 
                  />
                </svg>
                <h3 className="text-lg font-medium dark:text-white">
                  {t('requestAccess.thankYou')}
                </h3>
                <p className="text-gray-500 dark:text-gray-400">
                  {t('requestAccess.weWillContact')}
                </p>
                <Button asChild className="mt-4">
                  <Link to="/">{t('common.back')}</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="email" className="font-medium text-gray-700 dark:text-gray-300">
                    {t('requestAccess.emailLabel')} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('requestAccess.emailPlaceholder')}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="name" className="font-medium text-gray-700 dark:text-gray-300">
                    {t('requestAccess.nameLabel')} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('requestAccess.namePlaceholder')}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="institution" className="font-medium text-gray-700 dark:text-gray-300">
                    {t('requestAccess.institutionLabel')} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="institution"
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    placeholder={t('requestAccess.institutionPlaceholder')}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="reason" className="font-medium text-gray-700 dark:text-gray-300">
                    {t('requestAccess.reasonLabel')} <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('requestAccess.reasonPlaceholder')}
                    rows={4}
                    required
                  />
                </div>
                
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('requestAccess.agreeToTerms')}{' '}
                  <Link to="/terms-of-service" className="text-blue-600 hover:underline dark:text-blue-400 font-bold">
                    {t('common.termsOfService')}
                  </Link>{' '}
                  {t('requestAccess.and')}{' '}
                  <Link to="/privacy-policy" className="text-blue-600 hover:underline dark:text-blue-400 font-bold">
                    {t('common.privacyPolicy')}
                  </Link>
                </p>
                
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isSubmitting}
                >
                  {isSubmitting ? t('requestAccess.submittingRequest') : t('requestAccess.submitRequest')}
                </Button>
              </form>
            )}
          </CardContent>
          
          <CardFooter className="justify-center border-t px-6 py-4 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700">
            <div className="text-center text-sm text-gray-500 dark:text-gray-400">
              {t('auth.alreadyHaveAccount')}{' '}
              <Link 
                to="/sign-in"
                className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                {t('auth.signIn')}
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default RequestAccess;
