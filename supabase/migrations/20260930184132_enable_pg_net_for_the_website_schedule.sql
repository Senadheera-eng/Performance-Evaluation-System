-- pg_net lets the database make the nightly call that reads the faculty
-- website (see the_faculty_website_is_read_every_night).
create extension if not exists pg_net with schema extensions;
