-- Atomic rate limit function (no race condition)
CREATE OR REPLACE FUNCTION check_and_log_image_usage(
  p_user_id UUID,
  p_model TEXT DEFAULT 'cx/gpt-5.5-image'
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
  -- Lock the user's row to prevent race conditions
  v_today_start := DATE_TRUNC('day', NOW());
  
  -- Get user's daily limit
  SELECT COALESCE(daily_image_limit, 15) INTO v_limit
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;  -- Lock the row
  
  -- Count today's usage
  SELECT COUNT(*)::INT INTO v_used
  FROM usage_logs
  WHERE user_id = p_user_id
    AND type = 'image'
    AND created_at >= v_today_start;
  
  -- Calculate
  v_remaining := v_limit - v_used;
  v_allowed := v_remaining > 0;
  v_reset_at := v_today_start + INTERVAL '1 day';
  
  -- If allowed, insert usage log immediately (atomic)
  IF v_allowed THEN
    INSERT INTO usage_logs (user_id, type, model, tokens)
    VALUES (p_user_id, 'image', p_model, 0);
    
    v_used := v_used + 1;
    v_remaining := v_remaining - 1;
  END IF;
  
  -- Return result
  RETURN json_build_object(
    'allowed', v_allowed,
    'used', v_used,
    'remaining', GREATEST(0, v_remaining),
    'reset_at', v_reset_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
