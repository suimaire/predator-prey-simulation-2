/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 프로젝트 URL. 비어 있으면 leaderboard 없이 동작합니다. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon public key. 공개되어도 되는 값이며 RLS로 권한을 제한합니다. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** 제출 대상 원본 테이블. 기본값은 apex_leaderboard 이며 학생은 읽을 수 없습니다. */
  readonly VITE_LEADERBOARD_TABLE?: string;
  /** 조회 대상 공개 view. 기본값은 `${VITE_LEADERBOARD_TABLE}_public` 입니다. */
  readonly VITE_LEADERBOARD_PUBLIC_VIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
