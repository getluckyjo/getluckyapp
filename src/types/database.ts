/**
 * Database types for the Supabase clients.
 *
 * Written from supabase/migrations/001–010 so the three clients can be
 * typed (`createClient<Database>`), which makes a misspelt column or a
 * wrong enum value a compile error instead of a runtime 400.
 *
 * Regenerate from the live schema whenever a migration lands:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
 *
 * and keep the hand-maintained `members` block (the funnel's table, which
 * lives in the same project but is not defined by this repo's migrations).
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type WitnessRole = 'witness' | 'club_official'
export type WitnessSource = 'claimant' | 'course'
export type WitnessResponse = 'confirmed' | 'denied'
export type BetTier = 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4' | 'tier_5' | 'tier_6'
export type BetStatus = 'active' | 'miss' | 'claimed' | 'verified' | 'paid'
export type VerificationStatus = 'pending' | 'documents_received' | 'under_review' | 'approved' | 'rejected'
export type LeadLane = 'partner' | 'investor'
export type BetaAccessKind = 'email' | 'code'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          name: string | null
          email: string | null
          handicap: number | null
          home_course_id: string | null
          payment_method: string | null
          payment_token: string | null
          onboarding_done: boolean
          payment_setup_done: boolean
          total_attempts: number
          is_admin: boolean
          suspended_at: string | null
          suspended_reason: string | null
          date_of_birth: string | null
          age_verified_at: string | null
          terms_accepted_at: string | null
          updated_by: string | null
          created_at: string
        }
        Insert: {
          id: string
          name?: string | null
          email?: string | null
          handicap?: number | null
          home_course_id?: string | null
          payment_method?: string | null
          payment_token?: string | null
          onboarding_done?: boolean
          payment_setup_done?: boolean
          total_attempts?: number
          is_admin?: boolean
          suspended_at?: string | null
          suspended_reason?: string | null
          date_of_birth?: string | null
          age_verified_at?: string | null
          terms_accepted_at?: string | null
          updated_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string | null
          email?: string | null
          handicap?: number | null
          home_course_id?: string | null
          payment_method?: string | null
          payment_token?: string | null
          onboarding_done?: boolean
          payment_setup_done?: boolean
          total_attempts?: number
          is_admin?: boolean
          suspended_at?: string | null
          suspended_reason?: string | null
          date_of_birth?: string | null
          age_verified_at?: string | null
          terms_accepted_at?: string | null
          updated_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      courses: {
        Row: {
          id: string
          name: string
          location_text: string | null
          region: string | null
          country: string
          lat: number | null
          lng: number | null
          image_url: string | null
          is_partner: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          location_text?: string | null
          region?: string | null
          country?: string
          lat?: number | null
          lng?: number | null
          image_url?: string | null
          is_partner?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          location_text?: string | null
          region?: string | null
          country?: string
          lat?: number | null
          lng?: number | null
          image_url?: string | null
          is_partner?: boolean
          created_at?: string
        }
        Relationships: []
      }
      holes: {
        Row: {
          id: string
          course_id: string
          hole_number: number
          par: number
          distance_metres: number | null
          is_active: boolean
          jackpot_amount: number
          created_at: string
        }
        Insert: {
          id?: string
          course_id: string
          hole_number: number
          par?: number
          distance_metres?: number | null
          is_active?: boolean
          jackpot_amount?: number
          created_at?: string
        }
        Update: {
          id?: string
          course_id?: string
          hole_number?: number
          par?: number
          distance_metres?: number | null
          is_active?: boolean
          jackpot_amount?: number
          created_at?: string
        }
        Relationships: []
      }
      bets: {
        Row: {
          id: string
          user_id: string
          course_id: string
          hole_id: string
          tier: BetTier
          stake_pence: number
          potential_win_pence: number
          status: BetStatus
          payment_intent_id: string | null
          pf_payment_id: string | null
          video_url: string | null
          video_sha256: string | null
          video_bytes: number | null
          video_uploaded_at: string | null
          footage_purged_at: string | null
          capture_started_at: string | null
          capture_ended_at: string | null
          capture_duration_ms: number | null
          capture_lat: number | null
          capture_lng: number | null
          capture_accuracy_m: number | null
          capture_distance_m: number | null
          capture_user_agent: string | null
          created_ip_hash: string | null
          claim_ip_hash: string | null
          claim_ua_hash: string | null
          risk_score: number
          risk_flags: Json | null
          risk_evaluated_at: string | null
          payout_reference: string | null
          declared_result: 'miss' | 'win' | null
          declared_at: string | null
          expires_at: string
          updated_at: string | null
          updated_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          course_id: string
          hole_id: string
          tier: BetTier
          stake_pence: number
          potential_win_pence: number
          status?: BetStatus
          payment_intent_id?: string | null
          pf_payment_id?: string | null
          video_url?: string | null
          video_sha256?: string | null
          video_bytes?: number | null
          video_uploaded_at?: string | null
          footage_purged_at?: string | null
          capture_started_at?: string | null
          capture_ended_at?: string | null
          capture_duration_ms?: number | null
          capture_lat?: number | null
          capture_lng?: number | null
          capture_accuracy_m?: number | null
          capture_distance_m?: number | null
          capture_user_agent?: string | null
          created_ip_hash?: string | null
          claim_ip_hash?: string | null
          claim_ua_hash?: string | null
          risk_score?: number
          risk_flags?: Json | null
          risk_evaluated_at?: string | null
          payout_reference?: string | null
          declared_result?: 'miss' | 'win' | null
          declared_at?: string | null
          expires_at?: string
          updated_at?: string | null
          updated_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          course_id?: string
          hole_id?: string
          tier?: BetTier
          stake_pence?: number
          potential_win_pence?: number
          status?: BetStatus
          payment_intent_id?: string | null
          pf_payment_id?: string | null
          video_url?: string | null
          video_sha256?: string | null
          video_bytes?: number | null
          video_uploaded_at?: string | null
          footage_purged_at?: string | null
          capture_started_at?: string | null
          capture_ended_at?: string | null
          capture_duration_ms?: number | null
          capture_lat?: number | null
          capture_lng?: number | null
          capture_accuracy_m?: number | null
          capture_distance_m?: number | null
          capture_user_agent?: string | null
          created_ip_hash?: string | null
          claim_ip_hash?: string | null
          claim_ua_hash?: string | null
          risk_score?: number
          risk_flags?: Json | null
          risk_evaluated_at?: string | null
          payout_reference?: string | null
          declared_result?: 'miss' | 'win' | null
          declared_at?: string | null
          expires_at?: string
          updated_at?: string | null
          updated_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      verifications: {
        Row: {
          id: string
          bet_id: string
          status: VerificationStatus
          certificate_path: string | null
          affidavit_path: string | null
          footage_received_at: string | null
          documents_received_at: string | null
          verified_at: string | null
          payout_initiated_at: string | null
          documents_purged_at: string | null
          certificate_sha256: string | null
          certificate_bytes: number | null
          affidavit_sha256: string | null
          affidavit_bytes: number | null
          review_checklist: Json | null
          reviewer_notes: string | null
          reviewed_by: string | null
          updated_at: string | null
          updated_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          bet_id: string
          status?: VerificationStatus
          certificate_path?: string | null
          affidavit_path?: string | null
          footage_received_at?: string | null
          documents_received_at?: string | null
          verified_at?: string | null
          payout_initiated_at?: string | null
          documents_purged_at?: string | null
          certificate_sha256?: string | null
          certificate_bytes?: number | null
          affidavit_sha256?: string | null
          affidavit_bytes?: number | null
          review_checklist?: Json | null
          reviewer_notes?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
          updated_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          bet_id?: string
          status?: VerificationStatus
          certificate_path?: string | null
          affidavit_path?: string | null
          footage_received_at?: string | null
          documents_received_at?: string | null
          verified_at?: string | null
          payout_initiated_at?: string | null
          documents_purged_at?: string | null
          certificate_sha256?: string | null
          certificate_bytes?: number | null
          affidavit_sha256?: string | null
          affidavit_bytes?: number | null
          review_checklist?: Json | null
          reviewer_notes?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
          updated_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      payfast_payments: {
        Row: {
          id: string
          m_payment_id: string
          pf_payment_id: string | null
          user_id: string | null
          course_id: string | null
          hole_id: string | null
          tier: BetTier | null
          amount_cents: number
          status: 'complete' | 'amount_mismatch'
          raw_payload: Json | null
          bet_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          m_payment_id: string
          pf_payment_id?: string | null
          user_id?: string | null
          course_id?: string | null
          hole_id?: string | null
          tier?: BetTier | null
          amount_cents: number
          status?: 'complete' | 'amount_mismatch'
          raw_payload?: Json | null
          bet_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          m_payment_id?: string
          pf_payment_id?: string | null
          user_id?: string | null
          course_id?: string | null
          hole_id?: string | null
          tier?: BetTier | null
          amount_cents?: number
          status?: 'complete' | 'amount_mismatch'
          raw_payload?: Json | null
          bet_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      claim_events: {
        Row: {
          id: number
          bet_id: string
          verification_id: string | null
          table_name: string
          action: 'insert' | 'update'
          actor_id: string | null
          actor_role: string
          changed: Json | null
          before: Json | null
          after: Json
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      account_events: {
        Row: {
          id: number
          profile_id: string
          actor_id: string | null
          actor_role: string
          changed: Json
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      deleted_accounts: {
        Row: { id: string; email_hash: string; bets: number; claims: number; deleted_at: string }
        Insert: { id?: string; email_hash: string; bets?: number; claims?: number; deleted_at?: string }
        Update: never
        Relationships: []
      }
      claim_witnesses: {
        Row: {
          id: string
          bet_id: string
          verification_id: string | null
          role: WitnessRole
          name: string
          email: string
          source: WitnessSource
          token_hash: string | null
          token_expires_at: string | null
          requested_at: string | null
          request_count: number
          responded_at: string | null
          response: WitnessResponse | null
          response_note: string | null
          response_ip_hash: string | null
          response_user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          bet_id: string
          verification_id?: string | null
          role: WitnessRole
          name: string
          email: string
          source?: WitnessSource
          token_hash?: string | null
          token_expires_at?: string | null
          requested_at?: string | null
          request_count?: number
          responded_at?: string | null
          response?: WitnessResponse | null
          response_note?: string | null
          response_ip_hash?: string | null
          response_user_agent?: string | null
          created_at?: string
        }
        Update: {
          verification_id?: string | null
          role?: WitnessRole
          name?: string
          email?: string
          source?: WitnessSource
          token_hash?: string | null
          token_expires_at?: string | null
          requested_at?: string | null
          request_count?: number
          responded_at?: string | null
          response?: WitnessResponse | null
          response_note?: string | null
          response_ip_hash?: string | null
          response_user_agent?: string | null
        }
        Relationships: []
      }
      course_contacts: {
        Row: { id: string; course_id: string; name: string; email: string; role: 'club_official'; created_at: string }
        Insert: { id?: string; course_id: string; name: string; email: string; role?: 'club_official'; created_at?: string }
        Update: { name?: string; email?: string }
        Relationships: []
      }
      outbox: {
        Row: {
          id: number
          kind: string
          payload: Json
          attempts: number
          next_attempt_at: string
          last_error: string | null
          created_at: string
          done_at: string | null
          failed_at: string | null
        }
        Insert: { kind: string; payload: Json; attempts?: number; next_attempt_at?: string; last_error?: string | null; done_at?: string | null; failed_at?: string | null }
        Update: { attempts?: number; next_attempt_at?: string; last_error?: string | null; done_at?: string | null; failed_at?: string | null }
        Relationships: []
      }
      icons: {
        Row: {
          id: string
          name: string
          tagline: string | null
          photo_url: string | null
          sort_order: number
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          tagline?: string | null
          photo_url?: string | null
          sort_order?: number
          is_active?: boolean
          created_by?: string | null
        }
        Update: {
          name?: string
          tagline?: string | null
          photo_url?: string | null
          sort_order?: number
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      icon_votes: {
        Row: { user_id: string; icon_id: string; created_at: string; updated_at: string }
        Insert: { user_id: string; icon_id: string; updated_at?: string }
        Update: { icon_id?: string; updated_at?: string }
        Relationships: []
      }
      beta_access: {
        Row: { id: number; kind: BetaAccessKind; value: string; note: string | null; added_by: string | null; created_at: string }
        Insert: { kind: BetaAccessKind; value: string; note?: string | null; added_by?: string | null }
        Update: { note?: string | null }
        Relationships: []
      }
      feedback: {
        Row: {
          id: number
          user_id: string | null
          message: string
          route: string | null
          user_agent: string | null
          standalone: boolean | null
          app_version: string | null
          build_date: string | null
          screen: string | null
          created_at: string
        }
        Insert: {
          user_id?: string | null
          message: string
          route?: string | null
          user_agent?: string | null
          standalone?: boolean | null
          app_version?: string | null
          build_date?: string | null
          screen?: string | null
        }
        Update: never
        Relationships: []
      }
      rate_limits: {
        Row: { key: string; count: number; window_start: string }
        Insert: never
        Update: never
        Relationships: []
      }
      leads: {
        Row: {
          id: string
          email: string
          lane: LeadLane
          name: string | null
          company: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          lane: LeadLane
          name?: string | null
          company?: string | null
          note?: string | null
          created_at?: string
        }
        Update: never
        Relationships: []
      }
      // Owned and written by the external membership funnel
      // (membership.getluckygolfclub.com). This app only READS it, by email,
      // to show member status. Not defined by this repo's migrations.
      members: {
        Row: {
          id: string
          full_name: string
          email: string
          mobile: string
          club_id: string | null
          handicap: number | null
          subscription_status: string | null
          payfast_payment_id: string | null
          payfast_token: string | null
          joined_date: string | null
          last_payment_date: string | null
          cancelled_date: string | null
          cancellation_reason: string | null
          bag_tag_status: string | null
          is_founding_member: boolean | null
          referral_code: string | null
          referred_by: string | null
          plan_type: string
          indwe_credit_applied_until: string | null
          indwe_lead_id: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      increment_attempts: { Args: { user_id: string }; Returns: undefined }
      beta_check: { Args: { p_email: string | null; p_code: string | null }; Returns: boolean }
      rate_limit_hit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: { allowed: boolean; remaining: number; reset_at: string }[]
      }
      admin_totals: { Args: Record<string, never>; Returns: Json }
      admin_revenue_by_tier: {
        Args: Record<string, never>
        Returns: { tier: string; bet_count: number; revenue_cents: number; payout_cents: number }[]
      }
      admin_revenue_by_course: {
        Args: Record<string, never>
        Returns: { course_id: string; course_name: string; bet_count: number; revenue_cents: number }[]
      }
    }
    Enums: {
      bet_tier: BetTier
      bet_status: BetStatus
      verification_status: VerificationStatus
      lead_lane: LeadLane
    }
    CompositeTypes: Record<string, never>
  }
}
