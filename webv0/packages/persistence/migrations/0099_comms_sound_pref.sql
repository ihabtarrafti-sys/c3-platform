-- 0099 — Phase B-LIVE (Law 4): the notification sound is a PER-USER preference.
--
-- Browsers require a user gesture before audio, so a sound setting that cannot
-- fail honestly is a setting that lies. The column is the durable half; the
-- surface reports plainly when the browser has not yet permitted audio.
--
-- The DEFAULT is deliberate and narrow (Neural's lean, adopted): sound is ON
-- for the traffic aimed AT you — direct threads and mentions — and OFF for
-- broad thread traffic. A tool that pings for everything gets muted, and a
-- muted notifier is a lying notifier: it claims an active channel while
-- delivering nothing.
--
-- 0098 (Phase B, participant immutability) is the immediately preceding
-- migration and is still awaiting the owner's window; this number was
-- re-derived at authoring rather than carried from memory.
--
-- The staging APPLY is the OWNER's, at the next deploy window.
ALTER TABLE comms_user_preference
  ADD COLUMN sound_direct_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE comms_user_preference
  ADD COLUMN sound_thread_enabled boolean NOT NULL DEFAULT false;
