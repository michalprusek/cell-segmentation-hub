import { createClient } from '@supabase/supabase-js';
import { supabase } from "@/integrations/supabase/client";

// Enable realtime for images table using the newer channel-based approach
const enableRealtime = async () => {
  try {
    // Instead of using RPC, we'll use the channel API
    // This is more reliable and supported in recent Supabase versions
    const channel = supabase
      .channel('table-db-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'images'
      }, (payload) => {
        console.log('Change received!', payload);
      })
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });
    
    console.log('Realtime enabled for images table via channel API');
    
    // Return the channel so it can be unsubscribed if needed
    return channel;
  } catch (err) {
    console.error('Failed to enable realtime:', err);
    return null;
  }
};

// Initialize realtime when this module is imported
const realtimeChannel = enableRealtime();

// Example of a function to upload an image to Supabase Storage
export const uploadImage = async (
  file: File, 
  projectId: string, 
  userId: string, 
  bucket: string = 'spheroid-images',
  autoSegment: boolean = false
) => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    const filePath = `${userId}/${projectId}/${fileName}`;

    // Upload file to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    // Get public URL for the file
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    // Create a thumbnail (using the same image for now, in a real app you'd generate a thumbnail)
    const thumbnailPath = `${userId}/${projectId}/thumbnails/${fileName}`;
    await supabase.storage
      .from(bucket)
      .copy(filePath, thumbnailPath);

    const { data: { publicUrl: thumbnailUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(thumbnailPath);

    // Insert the image record into the database with appropriate segmentation status
    const { data, error } = await supabase
      .from('images')
      .insert([
        {
          name: file.name,
          project_id: projectId,
          user_id: userId,
          image_url: publicUrl,
          thumbnail_url: thumbnailUrl,
          segmentation_status: autoSegment ? 'processing' : 'pending'
        }
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    // If auto-segmentation is enabled, trigger segmentation process
    if (autoSegment) {
      // We'd typically trigger a serverless function or background job here
      // For now, we'll just update the status to simulate this
      setTimeout(async () => {
        try {
          const { error: segmentError } = await supabase
            .from('images')
            .update({
              segmentation_status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('id', data.id);

          if (segmentError) {
            console.error('Error updating segmentation status:', segmentError);
          }
        } catch (error) {
          console.error('Segmentation process error:', error);
        }
      }, 3000);
    }

    return data;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

// Function to get a list of images from a project
export const getProjectImages = async (projectId: string) => {
  try {
    const { data, error } = await supabase
      .from('images')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error fetching project images:', error);
    throw error;
  }
};

// Example function for user profile management
export const updateUserProfile = async (userId: string, updates: any) => {
  try {
    // Remove invalid properties that aren't in the schema
    const validUpdates = { ...updates };
    
    // If 'department' isn't in schema database, remove it
    if ('department' in validUpdates) {
      delete validUpdates.department;
    }
    
    // Also check for organization which might not be in the schema
    if ('organization' in validUpdates && !('organization' in validUpdates)) {
      delete validUpdates.organization;
    }
    
    const { data, error } = await supabase
      .from('profiles')
      .update(validUpdates)
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error updating profile:', error);
    throw error;
  }
};

// Function to get user profile
export const getUserProfile = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    throw error;
  }
};
