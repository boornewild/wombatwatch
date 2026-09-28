export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      burrow_logs: {
        Row: {
          at: string;
          burrow_id: string;
          by_name: string | null;
          condition: string | null;
          created_at: string;
          created_by: string | null;
          height_cm: number | null;
          id: string;
          note: string | null;
          occupants: number | null;
          orientation: string | null;
          status: string | null;
          substrate: string | null;
          updated_at: string | null;
          vegetation: string | null;
          width_cm: number | null;
        };
        Insert: {
          at: string;
          burrow_id: string;
          by_name?: string | null;
          condition?: string | null;
          created_at?: string;
          created_by?: string | null;
          height_cm?: number | null;
          id: string;
          note?: string | null;
          occupants?: number | null;
          orientation?: string | null;
          status?: string | null;
          substrate?: string | null;
          updated_at?: string | null;
          vegetation?: string | null;
          width_cm?: number | null;
        };
        Update: {
          at?: string;
          burrow_id?: string;
          by_name?: string | null;
          condition?: string | null;
          created_at?: string;
          created_by?: string | null;
          height_cm?: number | null;
          id?: string;
          note?: string | null;
          occupants?: number | null;
          orientation?: string | null;
          status?: string | null;
          substrate?: string | null;
          updated_at?: string | null;
          vegetation?: string | null;
          width_cm?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'burrow_logs_burrow_id_fkey';
            columns: ['burrow_id'];
            isOneToOne: false;
            referencedRelation: 'burrows';
            referencedColumns: ['id'];
          },
        ];
      };
      burrow_photos: {
        Row: {
          at: string;
          burrow_id: string;
          created_at: string;
          created_by: string | null;
          data_url: string | null;
          id: string;
          is_profile: boolean;
          updated_at: string | null;
        };
        Insert: {
          at?: string;
          burrow_id: string;
          created_at?: string;
          created_by?: string | null;
          data_url?: string | null;
          id: string;
          is_profile?: boolean;
          updated_at?: string | null;
        };
        Update: {
          at?: string;
          burrow_id?: string;
          created_at?: string;
          created_by?: string | null;
          data_url?: string | null;
          id?: string;
          is_profile?: boolean;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'burrow_photos_burrow_id_fkey';
            columns: ['burrow_id'];
            isOneToOne: false;
            referencedRelation: 'burrows';
            referencedColumns: ['id'];
          },
        ];
      };
      burrows: {
        Row: {
          code: string | null;
          created_at: string;
          created_by: string | null;
          entrance_height_cm: number | null;
          entrance_width_cm: number | null;
          habitat: NonNullable<Json>;
          id: string;
          last_checked: string | null;
          lat: number | null;
          lng: number | null;
          location: string | null;
          name: string;
          next_check: string | null;
          orientation: string | null;
          squad_id: string | null;
          status: string | null;
          updated_at: string;
          wombat_ids: string[];
        };
        Insert: {
          code?: string | null;
          created_at?: string;
          created_by?: string | null;
          entrance_height_cm?: number | null;
          entrance_width_cm?: number | null;
          habitat?: NonNullable<Json>;
          id: string;
          last_checked?: string | null;
          lat?: number | null;
          lng?: number | null;
          location?: string | null;
          name: string;
          next_check?: string | null;
          orientation?: string | null;
          squad_id?: string | null;
          status?: string | null;
          updated_at?: string;
          wombat_ids?: string[];
        };
        Update: {
          code?: string | null;
          created_at?: string;
          created_by?: string | null;
          entrance_height_cm?: number | null;
          entrance_width_cm?: number | null;
          habitat?: NonNullable<Json>;
          id?: string;
          last_checked?: string | null;
          lat?: number | null;
          lng?: number | null;
          location?: string | null;
          name?: string;
          next_check?: string | null;
          orientation?: string | null;
          squad_id?: string | null;
          status?: string | null;
          updated_at?: string;
          wombat_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'burrows_squad_id_fkey';
            columns: ['squad_id'];
            isOneToOne: false;
            referencedRelation: 'squads';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          role: string;
          streak_count: number;
          streak_week_key: string;
          wombat_order: Json | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          role?: string;
          streak_count?: number;
          streak_week_key?: string;
          wombat_order?: Json | null;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          role?: string;
          streak_count?: number;
          streak_week_key?: string;
          wombat_order?: Json | null;
        };
        Relationships: [];
      };
      sightings: {
        Row: {
          at: string;
          created_at: string;
          created_by: string | null;
          id: string;
          lat: number | null;
          lng: number | null;
          note: string | null;
          updated_at: string | null;
          wombat_id: string;
        };
        Insert: {
          at: string;
          created_at?: string;
          created_by?: string | null;
          id: string;
          lat?: number | null;
          lng?: number | null;
          note?: string | null;
          updated_at?: string | null;
          wombat_id: string;
        };
        Update: {
          at?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          note?: string | null;
          updated_at?: string | null;
          wombat_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sightings_wombat_id_fkey';
            columns: ['wombat_id'];
            isOneToOne: false;
            referencedRelation: 'wombats';
            referencedColumns: ['id'];
          },
        ];
      };
      squad_invites: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          max_uses: number | null;
          squad_id: string;
          token: string;
          use_count: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          squad_id: string;
          token?: string;
          use_count?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          squad_id?: string;
          token?: string;
          use_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'squad_invites_squad_id_fkey';
            columns: ['squad_id'];
            isOneToOne: false;
            referencedRelation: 'squads';
            referencedColumns: ['id'];
          },
        ];
      };
      squad_members: {
        Row: {
          id: string;
          joined_at: string;
          role: string;
          squad_id: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          joined_at?: string;
          role?: string;
          squad_id: string;
          user_id: string;
        };
        Update: {
          id?: string;
          joined_at?: string;
          role?: string;
          squad_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'squad_members_squad_id_fkey';
            columns: ['squad_id'];
            isOneToOne: false;
            referencedRelation: 'squads';
            referencedColumns: ['id'];
          },
        ];
      };
      squads: {
        Row: {
          bounds_ne_lat: number | null;
          bounds_ne_lng: number | null;
          bounds_sw_lat: number | null;
          bounds_sw_lng: number | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          emergency_contacts: Json | null;
          id: string;
          name: string;
        };
        Insert: {
          bounds_ne_lat?: number | null;
          bounds_ne_lng?: number | null;
          bounds_sw_lat?: number | null;
          bounds_sw_lng?: number | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          emergency_contacts?: Json | null;
          id?: string;
          name: string;
        };
        Update: {
          bounds_ne_lat?: number | null;
          bounds_ne_lng?: number | null;
          bounds_sw_lat?: number | null;
          bounds_sw_lng?: number | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          emergency_contacts?: Json | null;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      treatments: {
        Row: {
          at: string;
          by_name: string | null;
          created_at: string;
          created_by: string | null;
          dose: string | null;
          id: string;
          linked_burrow_id: string | null;
          marked_recovered: boolean | null;
          method: string | null;
          note: string | null;
          product: string | null;
          regions: NonNullable<Json>;
          severity: number | null;
          updated_at: string | null;
          wombat_id: string;
        };
        Insert: {
          at: string;
          by_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          dose?: string | null;
          id: string;
          linked_burrow_id?: string | null;
          marked_recovered?: boolean | null;
          method?: string | null;
          note?: string | null;
          product?: string | null;
          regions?: NonNullable<Json>;
          severity?: number | null;
          updated_at?: string | null;
          wombat_id: string;
        };
        Update: {
          at?: string;
          by_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          dose?: string | null;
          id?: string;
          linked_burrow_id?: string | null;
          marked_recovered?: boolean | null;
          method?: string | null;
          note?: string | null;
          product?: string | null;
          regions?: NonNullable<Json>;
          severity?: number | null;
          updated_at?: string | null;
          wombat_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'treatments_linked_burrow_id_fkey';
            columns: ['linked_burrow_id'];
            isOneToOne: false;
            referencedRelation: 'burrows';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'treatments_wombat_id_fkey';
            columns: ['wombat_id'];
            isOneToOne: false;
            referencedRelation: 'wombats';
            referencedColumns: ['id'];
          },
        ];
      };
      wombat_photos: {
        Row: {
          at: string;
          created_at: string;
          created_by: string | null;
          data_url: string | null;
          id: string;
          is_profile: boolean;
          updated_at: string | null;
          wombat_id: string;
        };
        Insert: {
          at?: string;
          created_at?: string;
          created_by?: string | null;
          data_url?: string | null;
          id: string;
          is_profile?: boolean;
          updated_at?: string | null;
          wombat_id: string;
        };
        Update: {
          at?: string;
          created_at?: string;
          created_by?: string | null;
          data_url?: string | null;
          id?: string;
          is_profile?: boolean;
          updated_at?: string | null;
          wombat_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'wombat_photos_wombat_id_fkey';
            columns: ['wombat_id'];
            isOneToOne: false;
            referencedRelation: 'wombats';
            referencedColumns: ['id'];
          },
        ];
      };
      wombats: {
        Row: {
          age_class: string | null;
          assignees: Json | null;
          burrow_ids: string[];
          code: string | null;
          created_at: string;
          created_by: string | null;
          first_seen: string | null;
          id: string;
          inactive_at: string | null;
          inactive_cause: string | null;
          inactive_notes: string | null;
          lat: number | null;
          lng: number | null;
          location: string | null;
          location_label: string | null;
          name: string;
          notes: string | null;
          severity: NonNullable<Json>;
          sex: string | null;
          squad_id: string | null;
          status: string | null;
          updated_at: string;
        };
        Insert: {
          age_class?: string | null;
          assignees?: Json | null;
          burrow_ids?: string[];
          code?: string | null;
          created_at?: string;
          created_by?: string | null;
          first_seen?: string | null;
          id: string;
          inactive_at?: string | null;
          inactive_cause?: string | null;
          inactive_notes?: string | null;
          lat?: number | null;
          lng?: number | null;
          location?: string | null;
          location_label?: string | null;
          name: string;
          notes?: string | null;
          severity?: NonNullable<Json>;
          sex?: string | null;
          squad_id?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Update: {
          age_class?: string | null;
          assignees?: Json | null;
          burrow_ids?: string[];
          code?: string | null;
          created_at?: string;
          created_by?: string | null;
          first_seen?: string | null;
          id?: string;
          inactive_at?: string | null;
          inactive_cause?: string | null;
          inactive_notes?: string | null;
          lat?: number | null;
          lng?: number | null;
          location?: string | null;
          location_label?: string | null;
          name?: string;
          notes?: string | null;
          severity?: NonNullable<Json>;
          sex?: string | null;
          squad_id?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'wombats_squad_id_fkey';
            columns: ['squad_id'];
            isOneToOne: false;
            referencedRelation: 'squads';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      assign_wombat: { Args: { p_wombat_id: string }; Returns: Json };
      create_squad: { Args: { p_description?: string; p_name: string }; Returns: Json };
      create_squad_invite: {
        Args: { p_expires_at?: string; p_max_uses?: number; p_squad_id: string };
        Returns: Json;
      };
      get_all_my_squads: {
        Args: Record<PropertyKey, never>;
        Returns: {
          bounds_ne_lat: number;
          bounds_ne_lng: number;
          bounds_sw_lat: number;
          bounds_sw_lng: number;
          emergency_contacts: Json;
          role: string;
          squad_id: string;
          squad_name: string;
        }[];
      };
      get_my_squad: {
        Args: Record<PropertyKey, never>;
        Returns: {
          bounds_ne_lat: number;
          bounds_ne_lng: number;
          bounds_sw_lat: number;
          bounds_sw_lng: number;
          emergency_contacts: Json;
          role: string;
          squad_id: string;
          squad_name: string;
        }[];
      };
      get_my_squad_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_squad_admin: { Args: { p_squad_id: string }; Returns: boolean };
      is_squad_member: { Args: { p_squad_id: string }; Returns: boolean };
      join_squad_by_invite: { Args: { p_token: string }; Returns: Json };
      unassign_wombat: { Args: { p_user_id: string; p_wombat_id: string }; Returns: Json };
      update_squad_bounds: {
        Args: { p_ne_lat: number; p_ne_lng: number; p_squad_id: string; p_sw_lat: number; p_sw_lng: number };
        Returns: Json;
      };
      update_squad_emergency_contacts: { Args: { p_contacts: Json; p_squad_id: string }; Returns: Json };
      volunteer_count: { Args: Record<PropertyKey, never>; Returns: number };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
