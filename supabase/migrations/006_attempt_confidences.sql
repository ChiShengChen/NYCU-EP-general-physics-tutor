-- Confidence calibration: every quiz/exam question can carry a self-rated
-- confidence score (1 = pure guess, 5 = very sure). When combined with the
-- grading result, this lets us flag dangerous misconceptions (high
-- confidence + wrong) and shake-out anxiety (low confidence + right) and
-- plot a calibration chart over time.

alter table attempts add column confidences jsonb not null default '{}'::jsonb;
