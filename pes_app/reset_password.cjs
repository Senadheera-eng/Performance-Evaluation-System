require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function resetPassword() {
  // First test with just your account
  const { data, error } = await supabase.auth.admin.updateUserById(
    '5c18bce6-065e-25be-b13e-2f03ba21f6d6',
    { password: 'pes@123' }
  );
  
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Password reset successfully for:', data.user.email);
  }
}

resetPassword();