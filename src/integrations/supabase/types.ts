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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      account_credentials: {
        Row: {
          account_id: string
          created_at: string
          owner_id: string
          password_enc: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          owner_id: string
          password_enc: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          owner_id?: string
          password_enc?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_credentials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "sending_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          ai_context: string
          app_url: string | null
          auto_close_days: number
          created_at: string
          first_campaign_approved_at: string | null
          owner_id: string
          send_end_hour: number
          send_start_hour: number
          send_weekdays_only: boolean
          signature: string
          timezone: string
          updated_at: string
        }
        Insert: {
          ai_context?: string
          app_url?: string | null
          auto_close_days?: number
          created_at?: string
          first_campaign_approved_at?: string | null
          owner_id: string
          send_end_hour?: number
          send_start_hour?: number
          send_weekdays_only?: boolean
          signature?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          ai_context?: string
          app_url?: string | null
          auto_close_days?: number
          created_at?: string
          first_campaign_approved_at?: string | null
          owner_id?: string
          send_end_hour?: number
          send_start_hour?: number
          send_weekdays_only?: boolean
          signature?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaign_leads: {
        Row: {
          ai_line: string | null
          campaign_id: string
          claimed_at: string | null
          created_at: string
          current_step: number
          error: string | null
          gmail_thread_id: string | null
          id: string
          last_sent_at: string | null
          lead_id: string
          nurture_sent_at: string | null
          owner_id: string
          sending_account_id: string | null
          sent_at: string | null
          sequence_claimed_at: string | null
          sequence_claimed_step: number | null
          sequence_stopped_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_line?: string | null
          campaign_id: string
          claimed_at?: string | null
          created_at?: string
          current_step?: number
          error?: string | null
          gmail_thread_id?: string | null
          id?: string
          last_sent_at?: string | null
          lead_id: string
          nurture_sent_at?: string | null
          owner_id?: string
          sending_account_id?: string | null
          sent_at?: string | null
          sequence_claimed_at?: string | null
          sequence_claimed_step?: number | null
          sequence_stopped_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_line?: string | null
          campaign_id?: string
          claimed_at?: string | null
          created_at?: string
          current_step?: number
          error?: string | null
          gmail_thread_id?: string | null
          id?: string
          last_sent_at?: string | null
          lead_id?: string
          nurture_sent_at?: string | null
          owner_id?: string
          sending_account_id?: string | null
          sent_at?: string | null
          sequence_claimed_at?: string | null
          sequence_claimed_step?: number | null
          sequence_stopped_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_sending_account_id_fkey"
            columns: ["sending_account_id"]
            isOneToOne: false
            referencedRelation: "sending_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          account_ids: string[]
          approved_at: string | null
          attachments: Json
          batch_size: number
          behavior: Json
          body: string
          completed_at: string | null
          created_at: string
          daily_limit: number
          follow_up_1_body: string
          follow_up_1_delay_days: number
          follow_up_2_body: string
          follow_up_2_delay_days: number
          follow_up_3_body: string
          follow_up_3_delay_days: number
          follow_ups: Json
          id: string
          name: string
          owner_id: string
          started_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          account_ids?: string[]
          approved_at?: string | null
          attachments?: Json
          batch_size?: number
          behavior?: Json
          body?: string
          completed_at?: string | null
          created_at?: string
          daily_limit?: number
          follow_up_1_body?: string
          follow_up_1_delay_days?: number
          follow_up_2_body?: string
          follow_up_2_delay_days?: number
          follow_up_3_body?: string
          follow_up_3_delay_days?: number
          follow_ups?: Json
          id?: string
          name: string
          owner_id?: string
          started_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          account_ids?: string[]
          approved_at?: string | null
          attachments?: Json
          batch_size?: number
          behavior?: Json
          body?: string
          completed_at?: string | null
          created_at?: string
          daily_limit?: number
          follow_up_1_body?: string
          follow_up_1_delay_days?: number
          follow_up_2_body?: string
          follow_up_2_delay_days?: number
          follow_up_3_body?: string
          follow_up_3_delay_days?: number
          follow_ups?: Json
          id?: string
          name?: string
          owner_id?: string
          started_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_states: {
        Row: {
          closed_reason: string | null
          owner_id: string
          status: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          closed_reason?: string | null
          owner_id?: string
          status?: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          closed_reason?: string | null
          owner_id?: string
          status?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_messages: {
        Row: {
          attachments: Json
          body: string
          campaign_id: string | null
          campaign_lead_id: string | null
          cc: string
          created_at: string
          direction: string
          error: string | null
          from_email: string
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          in_reply_to: string | null
          is_manual: boolean
          is_test: boolean
          lead_id: string | null
          owner_id: string
          read_at: string | null
          reply_category: string | null
          reply_summary: string | null
          rfc_message_id: string | null
          sending_account_id: string | null
          sent_at: string | null
          status: string
          step: number
          subject: string
          to_email: string
        }
        Insert: {
          attachments?: Json
          body?: string
          campaign_id?: string | null
          campaign_lead_id?: string | null
          cc?: string
          created_at?: string
          direction?: string
          error?: string | null
          from_email?: string
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          in_reply_to?: string | null
          is_manual?: boolean
          is_test?: boolean
          lead_id?: string | null
          owner_id?: string
          read_at?: string | null
          reply_category?: string | null
          reply_summary?: string | null
          rfc_message_id?: string | null
          sending_account_id?: string | null
          sent_at?: string | null
          status?: string
          step?: number
          subject?: string
          to_email: string
        }
        Update: {
          attachments?: Json
          body?: string
          campaign_id?: string | null
          campaign_lead_id?: string | null
          cc?: string
          created_at?: string
          direction?: string
          error?: string | null
          from_email?: string
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          in_reply_to?: string | null
          is_manual?: boolean
          is_test?: boolean
          lead_id?: string | null
          owner_id?: string
          read_at?: string | null
          reply_category?: string | null
          reply_summary?: string | null
          rfc_message_id?: string | null
          sending_account_id?: string | null
          sent_at?: string | null
          status?: string
          step?: number
          subject?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_sending_account_id_fkey"
            columns: ["sending_account_id"]
            isOneToOne: false
            referencedRelation: "sending_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          ai_line: string | null
          ai_line_at: string | null
          company: string
          created_at: string
          custom_fields: Json
          designation: string
          email: string
          email_check: string
          email_check_reason: string | null
          email_checked_at: string | null
          first_name: string
          id: string
          industry: string
          last_contacted_at: string | null
          last_name: string
          last_replied_at: string | null
          owner_id: string
          source: string
          status: string
          tags: string[]
          unsubscribe_token: string
          updated_at: string
        }
        Insert: {
          ai_line?: string | null
          ai_line_at?: string | null
          company?: string
          created_at?: string
          custom_fields?: Json
          designation?: string
          email: string
          email_check?: string
          email_check_reason?: string | null
          email_checked_at?: string | null
          first_name?: string
          id?: string
          industry?: string
          last_contacted_at?: string | null
          last_name?: string
          last_replied_at?: string | null
          owner_id?: string
          source?: string
          status?: string
          tags?: string[]
          unsubscribe_token?: string
          updated_at?: string
        }
        Update: {
          ai_line?: string | null
          ai_line_at?: string | null
          company?: string
          created_at?: string
          custom_fields?: Json
          designation?: string
          email?: string
          email_check?: string
          email_check_reason?: string | null
          email_checked_at?: string | null
          first_name?: string
          id?: string
          industry?: string
          last_contacted_at?: string | null
          last_name?: string
          last_replied_at?: string | null
          owner_id?: string
          source?: string
          status?: string
          tags?: string[]
          unsubscribe_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      sending_accounts: {
        Row: {
          created_at: string
          daily_limit: number
          dkim_selector: string | null
          dns_check: Json | null
          dns_checked_at: string | null
          email: string
          from_name: string
          id: string
          imap_host: string | null
          imap_last_uid: number | null
          imap_port: number | null
          imap_uidvalidity: number | null
          last_checked_at: string | null
          last_error: string | null
          owner_id: string
          provider: string
          provider_label: string
          secret_name: string
          signature: string
          smtp_host: string | null
          smtp_port: number | null
          status: string
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          daily_limit?: number
          dkim_selector?: string | null
          dns_check?: Json | null
          dns_checked_at?: string | null
          email: string
          from_name?: string
          id?: string
          imap_host?: string | null
          imap_last_uid?: number | null
          imap_port?: number | null
          imap_uidvalidity?: number | null
          last_checked_at?: string | null
          last_error?: string | null
          owner_id?: string
          provider?: string
          provider_label?: string
          secret_name: string
          signature?: string
          smtp_host?: string | null
          smtp_port?: number | null
          status?: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          daily_limit?: number
          dkim_selector?: string | null
          dns_check?: Json | null
          dns_checked_at?: string | null
          email?: string
          from_name?: string
          id?: string
          imap_host?: string | null
          imap_last_uid?: number | null
          imap_port?: number | null
          imap_uidvalidity?: number | null
          last_checked_at?: string | null
          last_error?: string | null
          owner_id?: string
          provider?: string
          provider_label?: string
          secret_name?: string
          signature?: string
          smtp_host?: string | null
          smtp_port?: number | null
          status?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      suppressions: {
        Row: {
          created_at: string
          email: string
          id: string
          note: string
          owner_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          note?: string
          owner_id?: string
          reason?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          note?: string
          owner_id?: string
          reason?: string
        }
        Relationships: []
      }
      templates: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          name: string
          owner_id: string
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          name: string
          owner_id?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          owner_id?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      close_inactive_conversations: { Args: never; Returns: number }
      enroll_leads: {
        Args: {
          _campaign_id: string
          _lead_ids?: string[]
          _skip_contacted?: boolean
          _statuses?: string[]
        }
        Returns: number
      }
      get_campaign_stats: {
        Args: never
        Returns: {
          campaign_id: string
          failed: number
          queued: number
          sending: number
          sent: number
          skipped: number
          total: number
        }[]
      }
      get_dashboard_stats: { Args: never; Returns: Json }
      get_inbox_threads: {
        Args: {
          _campaign_id?: string
          _filter?: string
          _limit?: number
          _status?: string
        }
        Returns: {
          account_email: string
          campaign_id: string
          campaign_name: string
          closed_reason: string
          from_email: string
          last_at: string
          lead_company: string
          lead_first_name: string
          lead_id: string
          lead_last_name: string
          lead_status: string
          message_count: number
          reply_category: string
          reply_summary: string
          sending_account_id: string
          snippet: string
          status: string
          subject: string
          thread_id: string
          unread: number
        }[]
      }
      get_sent_counts_since: {
        Args: { _since: string }
        Returns: {
          campaign_id: string
          n: number
          sending_account_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
