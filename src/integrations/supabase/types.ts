export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_notes: {
        Row: {
          content: Json
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: Json
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      auth_handoffs: {
        Row: {
          created_at: string
          nonce: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          nonce: string
          token_hash: string
        }
        Update: {
          created_at?: string
          nonce?: string
          token_hash?: string
        }
        Relationships: []
      }
      bug_reports: {
        Row: {
          created_at: string
          email: string | null
          id: string
          message: string
          page: string | null
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          message: string
          page?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          page?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          message: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: Json
          user_id?: string
        }
        Relationships: []
      }
      handover_config: {
        Row: {
          id: number
          token: string
        }
        Insert: {
          id?: number
          token?: string
        }
        Update: {
          id?: number
          token?: string
        }
        Relationships: []
      }
      library_tracks: {
        Row: {
          album: string | null
          artist_id: string | null
          artists: string
          created_at: string
          genres: string | null
          id: string
          image_url: string | null
          is_demo: boolean
          name: string
          preview_url: string | null
          source_name: string
          source_period: string | null
          source_type: string
          spotify_id: string
          spotify_url: string | null
          user_id: string
        }
        Insert: {
          album?: string | null
          artist_id?: string | null
          artists: string
          created_at?: string
          genres?: string | null
          id?: string
          image_url?: string | null
          is_demo?: boolean
          name: string
          preview_url?: string | null
          source_name: string
          source_period?: string | null
          source_type?: string
          spotify_id: string
          spotify_url?: string | null
          user_id: string
        }
        Update: {
          album?: string | null
          artist_id?: string | null
          artists?: string
          created_at?: string
          genres?: string | null
          id?: string
          image_url?: string | null
          is_demo?: boolean
          name?: string
          preview_url?: string | null
          source_name?: string
          source_period?: string | null
          source_type?: string
          spotify_id?: string
          spotify_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      listening_events: {
        Row: {
          artists: string | null
          created_at: string
          event: string
          id: string
          mode: string | null
          session_id: string | null
          track_id: string | null
          track_name: string | null
          user_id: string
        }
        Insert: {
          artists?: string | null
          created_at?: string
          event: string
          id?: string
          mode?: string | null
          session_id?: string | null
          track_id?: string | null
          track_name?: string | null
          user_id: string
        }
        Update: {
          artists?: string | null
          created_at?: string
          event?: string
          id?: string
          mode?: string | null
          session_id?: string | null
          track_id?: string | null
          track_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listening_events_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "library_tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      listening_history: {
        Row: {
          first_played: string | null
          last_played: string | null
          ms_played: number
          plays: number
          plays_by_year: Json | null
          spotify_id: string
          user_id: string
        }
        Insert: {
          first_played?: string | null
          last_played?: string | null
          ms_played?: number
          plays?: number
          plays_by_year?: Json | null
          spotify_id: string
          user_id: string
        }
        Update: {
          first_played?: string | null
          last_played?: string | null
          ms_played?: number
          plays?: number
          plays_by_year?: Json | null
          spotify_id?: string
          user_id?: string
        }
        Relationships: []
      }
      memory_nodes: {
        Row: {
          blob_id: string | null
          content: string
          created_at: string
          id: string
          kind: string
          origin: string
          status: string
          user_id: string
        }
        Insert: {
          blob_id?: string | null
          content: string
          created_at?: string
          id?: string
          kind: string
          origin?: string
          status?: string
          user_id: string
        }
        Update: {
          blob_id?: string | null
          content?: string
          created_at?: string
          id?: string
          kind?: string
          origin?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_handovers: {
        Row: {
          b_id: string
          created_at: string
          ends_at: string
          session_id: string
          status: string
          track_id: string
          updated_at: string
          user_id: string
          v_id: string | null
        }
        Insert: {
          b_id: string
          created_at?: string
          ends_at: string
          session_id: string
          status?: string
          track_id: string
          updated_at?: string
          user_id: string
          v_id?: string | null
        }
        Update: {
          b_id?: string
          created_at?: string
          ends_at?: string
          session_id?: string
          status?: string
          track_id?: string
          updated_at?: string
          user_id?: string
          v_id?: string | null
        }
        Relationships: []
      }
      spotify_connections: {
        Row: {
          access_token: string
          display_name: string | null
          expires_at: string
          last_recent_sync_at: string | null
          last_synced_at: string | null
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          display_name?: string | null
          expires_at: string
          last_recent_sync_at?: string | null
          last_synced_at?: string | null
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          display_name?: string | null
          expires_at?: string
          last_recent_sync_at?: string | null
          last_synced_at?: string | null
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      spotify_playlist_snapshots: {
        Row: {
          playlist_id: string
          snapshot_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          playlist_id: string
          snapshot_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          playlist_id?: string
          snapshot_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      arm_handover_tick: { Args: never; Returns: undefined }
      disarm_handover_tick: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
