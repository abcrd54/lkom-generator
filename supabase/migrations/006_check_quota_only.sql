-- Check-only function (no logging)
CREATE OR REPLACE FUNCTION check_image_quota(
  p_user_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_used INT;
  v_limit INT;
  v_remaining INT;
  v_reset_at TIMESTAMPTZ;
  v_allowed BOOLEAN;
BEGIN
  v_today_start := DATE_TRUNC('day', NOW());
  
  SELECT COALESCE(daily_image_limit, 15) INTO v_limit
  FROM profiles
  WHERE id = p_user_id;
  
  SELECT COUNT(*)::INT INTO v_used
  FROM usage_logs
  WHERE user_id = p_user_id
    AND type = 'image'
    AND created_at >= v_today_start;
  
  v_remaining := v_limit - v_used;
  v_allowed := v_remaining > 0;
  v_reset_at := v_today_start + INTERVAL '1 day';
  
  RETURN json_build_object(
    'allowed', v_allowed,
    'used', v_used,
    'remaining', GREATEST(0, v_remaining),
    'reset_at', v_reset_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
