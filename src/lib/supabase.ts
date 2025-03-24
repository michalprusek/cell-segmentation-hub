
import { createClient } from '@supabase/supabase-js';

// Note: In a production application, these would be environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Example of a function to upload an image to Supabase Storage
export const uploadImage = async (file: File, bucket: string = 'spheroid-images') => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    const filePath = `${fileName}`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

// Example function to get a list of images from a project
export const getProjectImages = async (projectId: string, bucket: string = 'spheroid-images') => {
  try {
    const { data, error } = await supabase
      .from('images')
      .select('*')
      .eq('project_id', projectId);

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error fetching project images:', error);
    throw error;
  }
};

// Example function for authentication
export const signInWithEmail = async (email: string, password: string) => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error signing in:', error);
    throw error;
  }
};
