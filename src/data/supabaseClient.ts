import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env';

const { supabaseUrl, supabaseAnonKey } = getEnv();

/** The one Supabase client for the app. Points at local, staging or production depending on the build. */
export const supa = createClient(supabaseUrl, supabaseAnonKey);
